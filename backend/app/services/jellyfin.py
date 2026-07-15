"""Jellyfin kliens: felhasználók, nézési analitika (ki mit nézett, mikor,
össz/átlag perc, hol tart) és user-provisioning (új felhasználó létrehozása)."""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

TICKS_PER_MINUTE = 10_000_000 * 60


class JellyfinError(Exception):
    pass


def _parse_jellyfin_dt(value: str | None) -> datetime | None:
    """Jellyfin ISO-dátum → tz-aware datetime. A Jellyfin 7 jegyű tört-
    másodperceit a Python max 6-ig érti, ezért levágjuk."""
    if not value:
        return None
    text = value.strip().replace("Z", "+00:00")
    if "." in text:
        base, _, rest = text.partition(".")
        frac, tz = rest, ""
        for sep in ("+", "-"):
            idx = rest.find(sep)
            if idx != -1:
                frac, tz = rest[:idx], rest[idx:]
                break
        text = f"{base}.{frac[:6]}{tz}"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _provider_id(provider_ids: dict[str, Any] | None, *keys: str) -> int | None:
    """Egy Jellyfin ProviderIds dict-ből kikeresi az első illeszkedő azonosítót
    (kis/nagybetű-érzéketlenül), és int-té alakítja."""
    lowered = {str(k).lower(): v for k, v in (provider_ids or {}).items()}
    for key in keys:
        raw = lowered.get(key.lower())
        if raw is None:
            continue
        try:
            return int(str(raw).strip())
        except (ValueError, TypeError):
            continue
    return None


class JellyfinClient:
    def __init__(self) -> None:
        self.base_url = settings.jellyfin_url.rstrip("/")
        self.api_key = settings.jellyfin_api_key

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    def _headers(self) -> dict[str, str]:
        return {"X-Emby-Token": self.api_key}

    async def _get(self, path: str, params: dict | None = None) -> Any:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(f"{self.base_url}{path}", headers=self._headers(), params=params or {})
            if r.status_code >= 400:
                raise JellyfinError(f"Jellyfin {path} → HTTP {r.status_code}")
            return r.json()

    async def list_users(self) -> list[dict[str, Any]]:
        return await self._get("/Users")

    async def create_user(self, name: str, password: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                f"{self.base_url}/Users/New",
                headers=self._headers(),
                json={"Name": name, "Password": password},
            )
            if r.status_code >= 400:
                raise JellyfinError(f"Jellyfin user létrehozás sikertelen: HTTP {r.status_code} {r.text[:200]}")
            return r.json()

    async def _user_stats(self, user: dict[str, Any]) -> dict[str, Any]:
        uid = user["Id"]
        try:
            played = await self._get(
                f"/Users/{uid}/Items",
                {
                    "Filters": "IsPlayed",
                    "Recursive": "true",
                    "IncludeItemTypes": "Movie,Episode",
                    "Fields": "UserData,RunTimeTicks,SeriesName",
                    "SortBy": "DatePlayed",
                    "SortOrder": "Descending",
                    "Limit": 500,
                },
            )
            resume = await self._get(
                f"/Users/{uid}/Items/Resume",
                {"Recursive": "true", "Fields": "UserData,RunTimeTicks,SeriesName", "Limit": 6},
            )
        except JellyfinError as exc:
            logger.warning("Jellyfin user-stat hiba (%s): %s", user.get("Name"), exc)
            played, resume = {"Items": []}, {"Items": []}

        items = played.get("Items") or []
        movies = sum(1 for it in items if it.get("Type") == "Movie")
        episodes = sum(1 for it in items if it.get("Type") == "Episode")
        total_minutes = 0
        for it in items:
            runtime = int(it.get("RunTimeTicks") or 0)
            play_count = int((it.get("UserData") or {}).get("PlayCount") or 1)
            total_minutes += (runtime * max(1, play_count)) // TICKS_PER_MINUTE

        def _label(it: dict) -> str:
            series = it.get("SeriesName")
            return f"{series} — {it.get('Name')}" if series else (it.get("Name") or "?")

        recent = [
            {
                "title": _label(it),
                "type": it.get("Type"),
                "last_played": (it.get("UserData") or {}).get("LastPlayedDate"),
                "minutes": int(it.get("RunTimeTicks") or 0) // TICKS_PER_MINUTE,
            }
            for it in items[:6]
        ]
        continue_watching = []
        for it in (resume.get("Items") or []):
            runtime = int(it.get("RunTimeTicks") or 0) or 1
            pos = int((it.get("UserData") or {}).get("PlaybackPositionTicks") or 0)
            continue_watching.append({"title": _label(it), "percent": round(pos / runtime * 100)})

        watched = len(items)
        return {
            "name": user.get("Name") or "?",
            "last_activity": user.get("LastActivityDate"),
            "last_login": user.get("LastLoginDate"),
            "watched_count": watched,
            "movies": movies,
            "episodes": episodes,
            "total_minutes": total_minutes,
            "avg_minutes": round(total_minutes / watched) if watched else 0,
            "recent": recent,
            "continue": continue_watching,
        }

    async def watch_analytics(self) -> dict[str, Any]:
        if not self.configured:
            return {"configured": False, "users": []}
        try:
            users = await self.list_users()
        except JellyfinError as exc:
            logger.warning("Jellyfin users lekérés sikertelen: %s", exc)
            return {"configured": True, "error": str(exc), "users": []}

        stats = await asyncio.gather(*[self._user_stats(u) for u in users])
        # Aktivitás szerint rendezve (legutóbb aktív elöl)
        stats.sort(key=lambda s: s.get("last_activity") or "", reverse=True)
        return {
            "configured": True,
            "users": stats,
            "total_users": len(stats),
            "total_minutes": sum(s["total_minutes"] for s in stats),
        }

    # ── Nézettség (stale-media + folytatás) ──────────────────────────────────

    async def _user_library_playdata(self, uid: str) -> list[dict[str, Any]]:
        """Egy user teljes Movie+Series listája UserData-val — a LastPlayedDate
        (sorozatnál a legutóbb nézett epizód ideje) a lényeg."""
        data = await self._get(
            f"/Users/{uid}/Items",
            {
                "Recursive": "true",
                "IncludeItemTypes": "Movie,Series",
                "Fields": "ProviderIds,UserData",
                "Limit": 5000,
            },
        )
        return data.get("Items") or []

    async def last_watched_map(self) -> dict[tuple[str, int], datetime]:
        """Provider-id → utoljára BÁRKI által lejátszott időpont. A kulcs
        ("movie", tmdb_id) filmnél és ("series", tvdb_id) sorozatnál — pont
        azok az azonosítók, amikkel a Radarr/Sonarr elemekhez lehet kötni."""
        if not self.configured:
            return {}
        try:
            users = await self.list_users()
        except JellyfinError as exc:
            logger.warning("Jellyfin last_watched: user-lista hiba: %s", exc)
            return {}

        results = await asyncio.gather(
            *[self._user_library_playdata(u["Id"]) for u in users],
            return_exceptions=True,
        )
        latest: dict[tuple[str, int], datetime] = {}
        for result in results:
            if isinstance(result, BaseException):
                logger.warning("Jellyfin last_watched: user-adat hiba: %s", result)
                continue
            for item in result:
                played_at = _parse_jellyfin_dt((item.get("UserData") or {}).get("LastPlayedDate"))
                if played_at is None:
                    continue
                provider_ids = item.get("ProviderIds") or {}
                item_type = item.get("Type")
                if item_type == "Movie":
                    ext = _provider_id(provider_ids, "Tmdb")
                    key = ("movie", ext) if ext else None
                elif item_type == "Series":
                    ext = _provider_id(provider_ids, "Tvdb")
                    key = ("series", ext) if ext else None
                else:
                    key = None
                if key is None:
                    continue
                current = latest.get(key)
                if current is None or played_at > current:
                    latest[key] = played_at
        return latest

    async def _user_resume(self, uid: str) -> list[dict[str, Any]]:
        data = await self._get(
            f"/Users/{uid}/Items/Resume",
            {
                "Recursive": "true",
                "IncludeItemTypes": "Movie,Episode",
                "Fields": "ProviderIds,RunTimeTicks,SeriesName,ProductionYear,UserData,SeriesId",
                "Limit": 12,
            },
        )
        return data.get("Items") or []

    async def _series_provider_ids(self, series_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Jellyfin SeriesId → ProviderIds egyetlen batch hívásban — az epizódok
        maguk nem hordozzák a sorozat TVDB-azonosítóját."""
        if not series_ids:
            return {}
        data = await self._get(
            "/Items",
            {"Ids": ",".join(series_ids), "Fields": "ProviderIds", "Recursive": "true"},
        )
        return {
            it["Id"]: (it.get("ProviderIds") or {})
            for it in (data.get("Items") or [])
            if it.get("Id")
        }

    async def continue_watching(self) -> list[dict[str, Any]]:
        """Folytatható (resume) tartalmak minden userből aggregálva, azonosító
        szerint dedupe-olva, a legnagyobb haladás elöl — az ajánló 'Folytatás'
        katalógusához. Sorozatnál az external_id a TVDB, filmnél a TMDB id."""
        if not self.configured:
            return []
        try:
            users = await self.list_users()
        except JellyfinError as exc:
            logger.warning("Jellyfin continue: user-lista hiba: %s", exc)
            return []

        results = await asyncio.gather(
            *[self._user_resume(u["Id"]) for u in users],
            return_exceptions=True,
        )
        raw_items: list[dict[str, Any]] = []
        series_ids: set[str] = set()
        for result in results:
            if isinstance(result, BaseException):
                logger.warning("Jellyfin continue: user-resume hiba: %s", result)
                continue
            for it in result:
                raw_items.append(it)
                if it.get("Type") == "Episode" and it.get("SeriesId"):
                    series_ids.add(it["SeriesId"])

        series_providers: dict[str, dict[str, Any]] = {}
        if series_ids:
            try:
                series_providers = await self._series_provider_ids(list(series_ids))
            except JellyfinError as exc:
                logger.warning("Jellyfin continue: sorozat-provider hiba: %s", exc)

        best: dict[tuple[str, Any], dict[str, Any]] = {}
        for it in raw_items:
            runtime = int(it.get("RunTimeTicks") or 0) or 1
            pos = int((it.get("UserData") or {}).get("PlaybackPositionTicks") or 0)
            percent = round(pos / runtime * 100)
            item_type = it.get("Type")
            if item_type == "Movie":
                tmdb = _provider_id(it.get("ProviderIds"), "Tmdb")
                key = ("movie", tmdb or it.get("Id"))
                entry = {
                    "title": it.get("Name") or "?",
                    "year": it.get("ProductionYear"),
                    "media_type": "movie",
                    "external_id": tmdb or 0,
                    "tmdb_id": tmdb,
                    "percent": percent,
                }
            elif item_type == "Episode":
                providers = series_providers.get(it.get("SeriesId") or "", {})
                tvdb = _provider_id(providers, "Tvdb")
                tmdb = _provider_id(providers, "Tmdb")
                key = ("series", tvdb or it.get("SeriesId") or it.get("Id"))
                entry = {
                    "title": it.get("SeriesName") or it.get("Name") or "?",
                    "year": None,
                    "media_type": "series",
                    "external_id": tvdb or 0,
                    "tmdb_id": tmdb,
                    "percent": percent,
                }
            else:
                continue
            prev = best.get(key)
            if prev is None or percent > prev["percent"]:
                best[key] = entry
        return sorted(best.values(), key=lambda e: e["percent"], reverse=True)
