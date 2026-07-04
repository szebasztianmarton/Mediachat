import os
import shutil
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from app.config import settings
from app.services.radarr import RadarrClient
from app.services.sonarr import SonarrClient


class StorageService:
    def __init__(self) -> None:
        self.sonarr = SonarrClient()
        self.radarr = RadarrClient()

    def get_status(self) -> dict[str, Any]:
        paths = {
            "cache": settings.cache_dir,
            "media": settings.media_root,
            "downloads": settings.download_temp_dir,
        }
        volumes: list[dict[str, Any]] = []
        min_free = settings.storage_min_free_gb * (1024**3)
        warnings: list[str] = []

        for name, path in paths.items():
            usage = self._path_usage(path)
            volumes.append({"name": name, "path": path, **usage})
            if usage["exists"] and usage["free_bytes"] < min_free:
                warnings.append(f"{name}: kevesebb mint {settings.storage_min_free_gb} GB szabad hely.")

        return {
            "volumes": volumes,
            "warnings": warnings,
            "min_free_gb": settings.storage_min_free_gb,
        }

    def cleanup_cache(self, max_age_days: int = 7) -> dict[str, Any]:
        cache_path = Path(settings.cache_dir)
        cache_path.mkdir(parents=True, exist_ok=True)
        cutoff = time.time() - (max_age_days * 86400)
        deleted_files = 0
        freed_bytes = 0

        for file_path in cache_path.rglob("*"):
            if not file_path.is_file():
                continue
            if file_path.stat().st_mtime < cutoff:
                freed_bytes += file_path.stat().st_size
                file_path.unlink(missing_ok=True)
                deleted_files += 1

        return {
            "deleted_files": deleted_files,
            "freed_mb": round(freed_bytes / (1024 * 1024), 2),
            "path": str(cache_path),
        }

    async def list_stale_media(self) -> list[dict[str, Any]]:
        cutoff = datetime.now(UTC) - timedelta(days=settings.stale_media_days)
        stale: list[dict[str, Any]] = []

        if self.radarr.configured:
            movies = await self.radarr.list_movies()
            history = await self.radarr.get_history()
            last_watched = self._latest_history(history, "movie")
            for movie in movies:
                movie_id = movie.get("id")
                if movie_id is None:
                    continue
                title = movie.get("title") or "Ismeretlen film"
                seen_at = last_watched.get(movie_id)
                if seen_at is None or seen_at < cutoff:
                    stale.append(
                        {
                            "title": title,
                            "media_type": "movie",
                            "external_id": movie.get("tmdbId") or 0,
                            "arr_id": movie_id,
                            "last_activity": seen_at.isoformat() if seen_at else None,
                            "days_idle": (datetime.now(UTC) - seen_at).days if seen_at else None,
                        }
                    )

        if self.sonarr.configured:
            series_list = await self.sonarr.list_series()
            history = await self.sonarr.get_history()
            last_watched = self._latest_history(history, "series")
            for series in series_list:
                series_id = series.get("id")
                if series_id is None:
                    continue
                title = series.get("title") or "Ismeretlen sorozat"
                seen_at = last_watched.get(series_id)
                if seen_at is None or seen_at < cutoff:
                    stale.append(
                        {
                            "title": title,
                            "media_type": "series",
                            "external_id": series.get("tvdbId") or 0,
                            "arr_id": series_id,
                            "last_activity": seen_at.isoformat() if seen_at else None,
                            "days_idle": (datetime.now(UTC) - seen_at).days if seen_at else None,
                        }
                    )

        stale.sort(key=lambda item: item.get("days_idle") or 9999, reverse=True)
        return stale

    async def apply_stale_action(
        self,
        media_type: Literal["movie", "series"],
        arr_id: int,
        action: Literal["delete", "unmonitor"],
    ) -> str:
        delete_files = settings.storage_delete_files and action == "delete"
        if media_type == "movie":
            if action == "unmonitor":
                movie = await self.radarr.get_movie(arr_id)
                movie["monitored"] = False
                await self.radarr.update_movie(movie)
                return "Film megfigyelése kikapcsolva (unmonitored)."
            await self.radarr.delete_movie(arr_id, delete_files=delete_files)
            return f"Film törölve (deleteFiles={delete_files})."

        if action == "unmonitor":
            series = await self.sonarr.get_series(arr_id)
            series["monitored"] = False
            await self.sonarr.update_series(series)
            return "Sorozat megfigyelése kikapcsolva (unmonitored)."
        await self.sonarr.delete_series(arr_id, delete_files=delete_files)
        return f"Sorozat törölve (deleteFiles={delete_files})."

    @staticmethod
    def _path_usage(path: str) -> dict[str, Any]:
        target = Path(path)
        if not target.exists():
            target.mkdir(parents=True, exist_ok=True)
        try:
            usage = shutil.disk_usage(target)
            return {
                "exists": True,
                "total_gb": round(usage.total / (1024**3), 2),
                "used_gb": round(usage.used / (1024**3), 2),
                "free_gb": round(usage.free / (1024**3), 2),
                "free_bytes": usage.free,
            }
        except OSError:
            return {
                "exists": False,
                "total_gb": 0,
                "used_gb": 0,
                "free_gb": 0,
                "free_bytes": 0,
            }

    @staticmethod
    def _latest_history(records: list[dict[str, Any]], kind: str) -> dict[int, datetime]:
        latest: dict[int, datetime] = {}
        for record in records:
            if record.get("eventType") not in {"grabbed", "downloadFolderImported"}:
                continue
            when = record.get("date")
            if not when:
                continue
            parsed = datetime.fromisoformat(when.replace("Z", "+00:00"))
            if kind == "movie":
                movie = record.get("movie") or {}
                item_id = movie.get("id")
            else:
                series = record.get("series") or {}
                item_id = series.get("id")
            if item_id is None:
                continue
            current = latest.get(item_id)
            if current is None or parsed > current:
                latest[item_id] = parsed
        return latest
