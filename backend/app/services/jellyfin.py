"""Jellyfin kliens: felhasználók, nézési analitika (ki mit nézett, mikor,
össz/átlag perc, hol tart) és user-provisioning (új felhasználó létrehozása)."""

import asyncio
import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

TICKS_PER_MINUTE = 10_000_000 * 60


class JellyfinError(Exception):
    pass


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
