"""Könyvtár-analitika: film/sorozat statisztikák, tárhely-elemzés és naptár
a Sonarr/Radarr adataiból."""

import asyncio
import logging
from collections import Counter
from typing import Any

from app.services.radarr import RadarrClient
from app.services.sonarr import SonarrClient

logger = logging.getLogger(__name__)


class LibraryService:
    def __init__(self) -> None:
        self.sonarr = SonarrClient()
        self.radarr = RadarrClient()

    # ── Statisztika ──────────────────────────────────────────────────────────

    async def stats(self) -> dict[str, Any]:
        movies, series = await asyncio.gather(
            self._safe(self.radarr.list_movies),
            self._safe(self.sonarr.list_series),
        )

        # Film-oldal
        movie_sizes = [int(m.get("sizeOnDisk") or 0) for m in movies]
        movies_with_file = sum(1 for m in movies if m.get("hasFile"))
        movie_genres = Counter(g for m in movies for g in (m.get("genres") or []))

        # Sorozat-oldal
        def _stat(s: dict, key: str) -> int:
            return int((s.get("statistics") or {}).get(key) or 0)

        series_sizes = [_stat(s, "sizeOnDisk") for s in series]
        total_seasons = sum(_stat(s, "seasonCount") for s in series)
        total_episodes = sum(_stat(s, "episodeFileCount") for s in series)
        series_genres = Counter(g for s in series for g in (s.get("genres") or []))

        combined_genres = movie_genres + series_genres

        return {
            "movies": {
                "count": len(movies),
                "with_file": movies_with_file,
                "missing": len(movies) - movies_with_file,
                "size_bytes": sum(movie_sizes),
                "top_genres": [{"name": g, "count": c} for g, c in movie_genres.most_common(8)],
            },
            "series": {
                "count": len(series),
                "seasons": total_seasons,
                "episodes": total_episodes,
                "size_bytes": sum(series_sizes),
                "top_genres": [{"name": g, "count": c} for g, c in series_genres.most_common(8)],
            },
            "combined": {
                "total_size_bytes": sum(movie_sizes) + sum(series_sizes),
                "top_genres": [{"name": g, "count": c} for g, c in combined_genres.most_common(10)],
            },
            "sonarr_configured": self.sonarr.configured,
            "radarr_configured": self.radarr.configured,
        }

    # ── Tárhely-elemzés ──────────────────────────────────────────────────────

    async def storage_analysis(self, top_n: int = 10) -> dict[str, Any]:
        movies, series, disk_r, disk_s = await asyncio.gather(
            self._safe(self.radarr.list_movies),
            self._safe(self.sonarr.list_series),
            self._safe(self.radarr.get_diskspace),
            self._safe(self.sonarr.get_diskspace),
        )

        def _stat(s: dict, key: str) -> int:
            return int((s.get("statistics") or {}).get(key) or 0)

        # Top helyfoglaló filmek (egy fájl → NINCS évad-átlag)
        top_movies = sorted(
            (
                {"title": m.get("title") or "?", "year": m.get("year"), "size_bytes": int(m.get("sizeOnDisk") or 0)}
                for m in movies
                if int(m.get("sizeOnDisk") or 0) > 0
            ),
            key=lambda x: x["size_bytes"],
            reverse=True,
        )[:top_n]

        # Top helyfoglaló sorozatok + évad-átlag (méret / évadszám)
        top_series = []
        for s in series:
            size = _stat(s, "sizeOnDisk")
            if size <= 0:
                continue
            seasons = _stat(s, "seasonCount") or 1
            episodes = _stat(s, "episodeFileCount") or 0
            top_series.append({
                "title": s.get("title") or "?",
                "year": s.get("year"),
                "size_bytes": size,
                "seasons": _stat(s, "seasonCount"),
                "episodes": episodes,
                "avg_per_season_bytes": round(size / seasons),
                "avg_per_episode_bytes": round(size / episodes) if episodes else None,
            })
        top_series.sort(key=lambda x: x["size_bytes"], reverse=True)
        top_series = top_series[:top_n]

        # Lemez-helyfoglalás (dedup path szerint, hogy ne duplázódjon Sonarr+Radarr)
        disks: dict[str, dict[str, Any]] = {}
        for entry in [*disk_r, *disk_s]:
            path = entry.get("path")
            if not path or path in disks:
                continue
            total = int(entry.get("totalSpace") or 0)
            free = int(entry.get("freeSpace") or 0)
            disks[path] = {
                "path": path,
                "total_bytes": total,
                "free_bytes": free,
                "used_bytes": total - free,
            }

        return {
            "top_movies": top_movies,
            "top_series": top_series,
            "disks": list(disks.values()),
            "movies_total_bytes": sum(int(m.get("sizeOnDisk") or 0) for m in movies),
            "series_total_bytes": sum(_stat(s, "sizeOnDisk") for s in series),
            "sonarr_configured": self.sonarr.configured,
            "radarr_configured": self.radarr.configured,
        }

    # ── Naptár ───────────────────────────────────────────────────────────────

    async def calendar(self, start: str, end: str) -> list[dict[str, Any]]:
        radarr_items, sonarr_items = await asyncio.gather(
            self._safe(lambda: self.radarr.get_calendar(start, end)),
            self._safe(lambda: self.sonarr.get_calendar(start, end)),
        )

        events: list[dict[str, Any]] = []
        for m in radarr_items:
            date = m.get("digitalRelease") or m.get("physicalRelease") or m.get("inCinemas")
            if not date:
                continue
            runtime = int(m.get("runtime") or 0)
            events.append({
                "date": date,
                "type": "movie",
                "title": m.get("title") or "?",
                "code": "",
                "subtitle": str(m.get("year") or ""),
                "runtime": runtime,
                "has_file": bool(m.get("hasFile")),
            })
        for ep in sonarr_items:
            date = ep.get("airDateUtc") or ep.get("airDate")
            if not date:
                continue
            series = ep.get("series") or {}
            series_title = series.get("title") or "?"
            season = ep.get("seasonNumber")
            number = ep.get("episodeNumber")
            code = f"{season}x{number:02d}" if season is not None and number is not None else ""
            runtime = int(ep.get("runtime") or series.get("runtime") or 0)
            events.append({
                "date": date,
                "type": "episode",
                "title": series_title,
                "code": code,
                "subtitle": ep.get("title") or "TBA",
                "runtime": runtime,
                "has_file": bool(ep.get("hasFile")),
            })
        events.sort(key=lambda e: e["date"])
        return events

    @staticmethod
    async def _safe(coro_fn) -> list:
        try:
            return await coro_fn()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Library adat lekérés sikertelen: %s", exc)
            return []
