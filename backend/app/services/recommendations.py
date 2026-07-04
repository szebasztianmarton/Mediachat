from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import MediaEvent
from app.models import RecommendationItem
from app.services.radarr import RadarrClient
from app.services.search import SearchService
from app.services.sonarr import SonarrClient
from app.services.tmdb import TmdbClient


class RecommendationService:
    def __init__(self, search_service: SearchService) -> None:
        self.search_service = search_service
        self.tmdb = TmdbClient()
        self.sonarr = SonarrClient()
        self.radarr = RadarrClient()

    async def get_catalog(
        self,
        db: AsyncSession,
        user_id: str,
        catalog: Literal["watched", "liked", "continue"],
        limit: int = 10,
    ) -> list[RecommendationItem]:
        if catalog == "watched":
            return await self._watched_catalog(db, user_id, limit)
        if catalog == "liked":
            return await self._liked_catalog(db, user_id, limit)
        return await self._continue_catalog(limit)

    async def _watched_catalog(self, db: AsyncSession, user_id: str, limit: int) -> list[RecommendationItem]:
        seeds = await self._seed_items(db, user_id, {"watched", "added"})
        return await self._similar_from_seeds(seeds, "Hasonló a már látott tartalmaidhoz", limit)

    async def _liked_catalog(self, db: AsyncSession, user_id: str, limit: int) -> list[RecommendationItem]:
        seeds = await self._seed_items(db, user_id, {"liked", "added"})
        return await self._similar_from_seeds(seeds, "A kedvelt tartalmaid alapján", limit)

    async def _continue_catalog(self, limit: int) -> list[RecommendationItem]:
        items: list[RecommendationItem] = []
        if not self.sonarr.configured:
            return items

        series_list = await self.sonarr.list_series()
        for series in series_list:
            stats = series.get("statistics") or {}
            episode_count = stats.get("episodeCount") or 0
            episode_file_count = stats.get("episodeFileCount") or 0
            if episode_count and episode_file_count < episode_count:
                remaining = episode_count - episode_file_count
                items.append(
                    RecommendationItem(
                        title=series.get("title") or "Ismeretlen sorozat",
                        year=series.get("year"),
                        overview=f"{remaining} epizód még hátravan.",
                        poster_url=self._poster_from_arr(series),
                        media_type="series",
                        external_id=series.get("tvdbId") or 0,
                        reason="Félbehagyott sorozat",
                    )
                )

        return items[:limit]

    async def _seed_items(
        self,
        db: AsyncSession,
        user_id: str,
        event_types: set[str],
    ) -> list[dict[str, Any]]:
        result = await db.execute(
            select(MediaEvent)
            .where(MediaEvent.user_id == user_id, MediaEvent.event_type.in_(event_types))
            .order_by(MediaEvent.created_at.desc())
            .limit(12)
        )
        seeds: list[dict[str, Any]] = []
        for event in result.scalars():
            seeds.append(
                {
                    "media_type": event.media_type,
                    "tmdb_id": event.tmdb_id or event.external_id,
                    "title": event.title,
                }
            )
        return seeds

    async def _similar_from_seeds(
        self,
        seeds: list[dict[str, Any]],
        reason_prefix: str,
        limit: int,
    ) -> list[RecommendationItem]:
        if not self.tmdb.configured or not seeds:
            return []

        seen: set[str] = set()
        output: list[RecommendationItem] = []

        for seed in seeds[:5]:
            tmdb_id = seed["tmdb_id"]
            media_type = seed["media_type"]
            try:
                similar = (
                    await self.tmdb.similar_movies(int(tmdb_id))
                    if media_type == "movie"
                    else await self.tmdb.similar_tv(int(tmdb_id))
                )
            except Exception:
                continue

            for item in similar[:5]:
                item_type = TmdbClient.media_type(item)
                if item_type is None:
                    continue
                dedupe = f"{item_type}:{item.get('id')}"
                if dedupe in seen:
                    continue
                seen.add(dedupe)
                recommendation = RecommendationItem(
                    title=self.tmdb.title(item),
                    year=self.tmdb.year(item),
                    overview=item.get("overview") or "",
                    poster_url=self.tmdb.poster_url(item),
                    media_type=item_type,
                    external_id=int(item.get("id") or 0),
                    tmdb_id=int(item.get("id") or 0),
                    reason=f"{reason_prefix}: {seed['title']}",
                )
                output.append(recommendation)
                if len(output) >= limit:
                    return output
        return output[:limit]

    @staticmethod
    def _poster_from_arr(item: dict[str, Any]) -> str | None:
        for image in item.get("images") or []:
            if image.get("coverType") == "poster":
                return image.get("remoteUrl") or image.get("url")
        return None

    async def record_feedback(
        self,
        db: AsyncSession,
        user_id: str,
        media_type: str,
        external_id: int,
        title: str,
        tmdb_id: int | None,
        liked: bool,
    ) -> None:
        await self.search_service.record_event(
            db,
            user_id,
            media_type,
            external_id,
            title,
            "liked" if liked else "dropped",
            tmdb_id=tmdb_id,
        )
