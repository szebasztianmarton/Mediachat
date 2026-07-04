import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_PLEX_TYPE_MAP = {"movie": "movie", "episode": "episode", "track": "music"}
_JELLYFIN_TYPE_MAP = {"Movie": "movie", "Episode": "episode", "Audio": "music"}


class MediaSessionsService:
    """Aktív lejátszási munkamenetek Plexből és/vagy Jellyfinből,
    a frontend "Most nézi" widgetének formátumában."""

    @property
    def configured(self) -> bool:
        return bool(settings.plex_url and settings.plex_token) or bool(
            settings.jellyfin_url and settings.jellyfin_api_key
        )

    async def list_sessions(self) -> list[dict[str, Any]]:
        sessions: list[dict[str, Any]] = []
        if settings.plex_url and settings.plex_token:
            try:
                sessions.extend(await self._plex_sessions())
            except (httpx.HTTPError, KeyError, ValueError) as exc:
                logger.warning("Plex sessions lekérdezés sikertelen: %s", exc)
        if settings.jellyfin_url and settings.jellyfin_api_key:
            try:
                sessions.extend(await self._jellyfin_sessions())
            except (httpx.HTTPError, KeyError, ValueError) as exc:
                logger.warning("Jellyfin sessions lekérdezés sikertelen: %s", exc)
        return sessions

    async def _plex_sessions(self) -> list[dict[str, Any]]:
        base = settings.plex_url.rstrip("/")
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{base}/status/sessions",
                headers={"X-Plex-Token": settings.plex_token, "Accept": "application/json"},
            )
            response.raise_for_status()
            metadata = (response.json().get("MediaContainer") or {}).get("Metadata") or []

        sessions: list[dict[str, Any]] = []
        for item in metadata:
            media_type = _PLEX_TYPE_MAP.get(item.get("type") or "")
            if media_type is None:
                continue
            if media_type == "episode":
                title = f"{item.get('grandparentTitle') or '?'} — {item.get('title') or '?'}"
            else:
                title = item.get("title") or "?"
            duration = int(item.get("duration") or 0)
            offset = int(item.get("viewOffset") or 0)
            player_state = ((item.get("Player") or {}).get("state") or "").lower()
            sessions.append(
                {
                    "id": f"plex-{item.get('sessionKey') or title}",
                    "username": (item.get("User") or {}).get("title") or "Ismeretlen",
                    "title": title,
                    "type": media_type,
                    "source": "plex",
                    "state": "paused" if player_state == "paused" else "playing",
                    "progressPercent": round(offset / duration * 100) if duration else 0,
                }
            )
        return sessions

    async def _jellyfin_sessions(self) -> list[dict[str, Any]]:
        base = settings.jellyfin_url.rstrip("/")
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{base}/Sessions",
                headers={"X-Emby-Token": settings.jellyfin_api_key},
            )
            response.raise_for_status()
            data = response.json()

        sessions: list[dict[str, Any]] = []
        for entry in data:
            item = entry.get("NowPlayingItem")
            if not item:
                continue
            media_type = _JELLYFIN_TYPE_MAP.get(item.get("Type") or "")
            if media_type is None:
                continue
            if media_type == "episode":
                title = f"{item.get('SeriesName') or '?'} — {item.get('Name') or '?'}"
            else:
                title = item.get("Name") or "?"
            runtime = int(item.get("RunTimeTicks") or 0)
            position = int((entry.get("PlayState") or {}).get("PositionTicks") or 0)
            paused = bool((entry.get("PlayState") or {}).get("IsPaused"))
            sessions.append(
                {
                    "id": f"jellyfin-{entry.get('Id') or title}",
                    "username": entry.get("UserName") or "Ismeretlen",
                    "title": title,
                    "type": media_type,
                    "source": "jellyfin",
                    "state": "paused" if paused else "playing",
                    "progressPercent": round(position / runtime * 100) if runtime else 0,
                }
            )
        return sessions
