import asyncio
import hashlib
import logging
from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import MediaEvent
from app.models import SearchResult
from app.services.cache import CacheService
from app.services.ollama import OllamaClient
from app.services.ranking import rank_local_results, rank_tmdb_results
from app.services.radarr import RadarrClient, RadarrError
from app.services.sonarr import SonarrClient, SonarrError
from app.services.tmdb import TmdbClient, TmdbError

logger = logging.getLogger(__name__)


class SearchService:
    TITLE_MATCH_THRESHOLD = 0.72

    def __init__(self, cache: CacheService) -> None:
        self.sonarr = SonarrClient()
        self.radarr = RadarrClient()
        self.tmdb = TmdbClient()
        self.ollama = OllamaClient()
        self.cache = cache
        self._lookup_cache: dict[str, dict[str, Any]] = {}
        self._lookup_cache_max = 500

    async def search(
        self,
        query: str,
        mode: Literal["auto", "title", "description"] = "auto",
    ) -> tuple[list[SearchResult], Literal["movie", "series"] | None, str]:
        query = query.strip()
        if not query:
            return [], None, "title"

        cache_key = f"search:{mode}:{hashlib.sha256(query.encode()).hexdigest()}"
        cached = await self.cache.get_json(cache_key)
        if cached:
            results = [SearchResult(**item) for item in cached["results"]]
            return results, cached.get("suggested_type"), cached.get("search_mode", mode)

        use_description = mode == "description" or (
            mode == "auto" and self._looks_like_description(query)
        )
        if not use_description:
            results, suggested_type = await self._title_search(query)
            if results and results[0].match_score >= self.TITLE_MATCH_THRESHOLD:
                await self._store_cache(cache_key, results, suggested_type, "title")
                return results, suggested_type, "title"
            if mode == "title":
                await self._store_cache(cache_key, results, suggested_type, "title")
                return results, suggested_type, "title"

        results, suggested_type = await self._description_search(query)
        await self._store_cache(cache_key, results, suggested_type, "description")
        return results, suggested_type, "description"

    async def _title_search(
        self,
        query: str,
    ) -> tuple[list[SearchResult], Literal["movie", "series"] | None]:
        series_items: list[dict[str, Any]] = []
        movie_items: list[dict[str, Any]] = []
        errors: list[str] = []

        tasks = []
        if self.sonarr.configured:
            tasks.append(("series", self.sonarr.lookup(query)))
        if self.radarr.configured:
            tasks.append(("movie", self.radarr.lookup(query)))

        if not tasks:
            raise ValueError("Sonarr and Radarr are not configured. Set API keys in .env.")

        results = await asyncio.gather(*[task for _, task in tasks], return_exceptions=True)
        for (kind, _), result in zip(tasks, results):
            if isinstance(result, Exception):
                errors.append(f"{kind}: {result}")
                continue
            if kind == "series":
                series_items = self.sonarr.to_search_results(query, result)
            else:
                movie_items = self.radarr.to_search_results(query, result)

        combined = rank_local_results(series_items + movie_items, query, limit=10)
        self._cache_lookup_items(combined)

        suggested_type: Literal["movie", "series"] | None = None
        if combined:
            suggested_type = combined[0]["media_type"]

        search_results = [self._to_search_result(item) for item in combined]
        if not search_results and errors:
            raise RuntimeError("; ".join(errors))
        return search_results, suggested_type

    async def _description_search(
        self,
        query: str,
    ) -> tuple[list[SearchResult], Literal["movie", "series"] | None]:
        if not self.tmdb.configured:
            raise ValueError("Description search requires TMDB_API_KEY.")

        intent = await self.ollama.extract_search_intent(query)
        tmdb_items: list[dict[str, Any]] = []
        for term in intent["search_terms"][:3]:
            try:
                tmdb_items.extend(await self.tmdb.search_multi(term))
            except TmdbError:
                continue

        ranked = rank_tmdb_results(tmdb_items, intent, limit=10)
        resolved: list[dict[str, Any]] = []

        for item in ranked:
            lookup_item = await self._resolve_tmdb_item(item["media_type"], item["tmdb_id"])
            if lookup_item:
                item["raw"] = lookup_item
                if item["media_type"] == "series":
                    item["external_id"] = lookup_item.get("tvdbId") or item["tmdb_id"]
                    item["title_slug"] = lookup_item.get("titleSlug")
                else:
                    item["external_id"] = lookup_item.get("tmdbId") or item["tmdb_id"]
                    item["title_slug"] = lookup_item.get("titleSlug")
                item["lookup_source"] = "local"
            else:
                item["raw"] = item.pop("raw_tmdb")
                item["lookup_source"] = "tmdb"
            resolved.append(item)

        self._cache_lookup_items(resolved)
        suggested_type = intent.get("media_type_hint") or (resolved[0]["media_type"] if resolved else None)
        return [self._to_search_result(item) for item in resolved], suggested_type

    async def _resolve_tmdb_item(
        self,
        media_type: Literal["movie", "series"],
        tmdb_id: int,
    ) -> dict[str, Any] | None:
        if media_type == "movie":
            if not self.radarr.configured:
                return None
            try:
                return await self.radarr.lookup_by_tmdb(tmdb_id)
            except RadarrError:
                return None

        if not self.tmdb.configured or not self.sonarr.configured:
            return None
        try:
            details = await self.tmdb.tv_details(tmdb_id)
            tvdb_id = (details.get("external_ids") or {}).get("tvdb_id")
            if tvdb_id:
                return await self.sonarr.lookup_by_tvdb(int(tvdb_id))
            name = details.get("name") or ""
            if not name:
                return None
            items = await self.sonarr.lookup(name)
            for item in items:
                if item.get("title", "").lower() == name.lower():
                    return item
            return None
        except (TmdbError, SonarrError, IndexError, TypeError, ValueError):
            return None

    async def add(
        self,
        media_type: Literal["movie", "series"],
        external_id: int,
        title: str,
        tmdb_id: int | None = None,
    ) -> tuple[str, str | None]:
        cache_key = self._cache_key(media_type, external_id)
        lookup_item = self._lookup_cache.get(cache_key)

        if lookup_item is None and tmdb_id:
            lookup_item = await self._resolve_tmdb_item(media_type, tmdb_id)

        if lookup_item is None:
            lookup_item = await self._refetch_lookup(media_type, external_id, title, tmdb_id)
            if lookup_item is None:
                raise ValueError("Could not find the selected title. Search again and retry.")

        if media_type == "series":
            if not self.sonarr.configured:
                raise ValueError("Sonarr is not configured.")
            try:
                added = await self.sonarr.add_series(lookup_item)
            except SonarrError as exc:
                raise ValueError(str(exc)) from exc
            quality_note = f"Sorozat hozzáadva, max minőség: {settings.max_series_quality}"
            return added.get("title") or title, quality_note

        if not self.radarr.configured:
            raise ValueError("Radarr is not configured.")
        try:
            added = await self.radarr.add_movie(lookup_item)
        except RadarrError as exc:
            raise ValueError(str(exc)) from exc
        return added.get("title") or title, None

    async def record_event(
        self,
        db: AsyncSession,
        user_id: str,
        media_type: str,
        external_id: int,
        title: str,
        event_type: str,
        tmdb_id: int | None = None,
    ) -> None:
        db.add(
            MediaEvent(
                user_id=user_id,
                media_type=media_type,
                external_id=external_id,
                tmdb_id=tmdb_id,
                title=title,
                event_type=event_type,
            )
        )
        await db.commit()

    async def _refetch_lookup(
        self,
        media_type: Literal["movie", "series"],
        external_id: int,
        title: str,
        tmdb_id: int | None = None,
    ) -> dict[str, Any] | None:
        if tmdb_id:
            resolved = await self._resolve_tmdb_item(media_type, tmdb_id)
            if resolved:
                return resolved

        if media_type == "series":
            item = await self.sonarr.lookup_by_tvdb(external_id)
            if item:
                return item
            items = await self.sonarr.lookup(title)
            for item in items:
                if item.get("tvdbId") == external_id:
                    return item
            return None

        item = await self.radarr.lookup_by_tmdb(external_id)
        if item:
            return item
        items = await self.radarr.lookup(title)
        for item in items:
            if item.get("tmdbId") == external_id:
                return item
        return None

    def _cache_lookup_items(self, items: list[dict[str, Any]]) -> None:
        if len(self._lookup_cache) >= self._lookup_cache_max:
            for key in list(self._lookup_cache)[:50]:
                del self._lookup_cache[key]
        for item in items:
            self._lookup_cache[self._cache_key(item["media_type"], item["external_id"])] = item.get("raw", item)

    async def _store_cache(
        self,
        cache_key: str,
        results: list[SearchResult],
        suggested_type: Literal["movie", "series"] | None,
        search_mode: str,
    ) -> None:
        await self.cache.set_json(
            cache_key,
            {
                "results": [result.model_dump() for result in results],
                "suggested_type": suggested_type,
                "search_mode": search_mode,
            },
        )

    @staticmethod
    def _to_search_result(item: dict[str, Any]) -> SearchResult:
        return SearchResult(
            result_id=item["result_id"],
            title=item["title"],
            year=item.get("year"),
            overview=item.get("overview") or "",
            poster_url=item.get("poster_url"),
            media_type=item["media_type"],
            external_id=item["external_id"],
            title_slug=item.get("title_slug"),
            match_score=item.get("match_score", 0.0),
            suggested=item.get("suggested", False),
            tmdb_id=item.get("tmdb_id"),
            lookup_source=item.get("lookup_source", "local"),
        )

    @staticmethod
    def _looks_like_description(query: str) -> bool:
        if len(query) > 45:
            return True
        if query.count(" ") >= 6:
            return True
        keywords = (
            "olyan", "mint", "keresek", "szeretnék", "film ahol", "sorozat ahol",
            "about", "where", "similar", "hasonló", "hangulat", "műfaj", "szerepl",
        )
        lower = query.lower()
        return any(keyword in lower for keyword in keywords)

    @staticmethod
    def _cache_key(media_type: str, external_id: int) -> str:
        return f"{media_type}:{external_id}"

    async def health(self) -> dict[str, bool | str | None]:
        async def _false() -> tuple[bool, str | None]:
            return False, None

        (sonarr_ok, sonarr_err), (radarr_ok, radarr_err), (ollama_ok, ollama_err) = (
            await asyncio.gather(
                self.sonarr.ping(),
                self.radarr.ping(),
                self.ollama.ping() if self.ollama.configured else _false(),
            )
        )
        tmdb_ok = self.tmdb.configured

        def _status(ok: bool, err: str | None) -> str:
            return "OK" if ok else f"FAIL ({err or 'ismeretlen ok'})"

        logger.info(
            "Health check | Sonarr: %s | Radarr: %s | Ollama: %s | TMDB: %s",
            _status(sonarr_ok, sonarr_err),
            _status(radarr_ok, radarr_err),
            _status(ollama_ok, ollama_err),
            "OK" if tmdb_ok else "FAIL (nincs TMDB_API_KEY)",
        )

        return {
            "sonarr": sonarr_ok,
            "radarr": radarr_ok,
            "ollama": ollama_ok,
            "tmdb": tmdb_ok,
            "sonarr_error": sonarr_err,
            "radarr_error": radarr_err,
            "ollama_error": ollama_err,
        }
