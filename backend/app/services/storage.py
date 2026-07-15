import logging
import os
import shutil
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from app.config import settings
from app.services.jellyfin import JellyfinClient
from app.services.radarr import RadarrClient
from app.services.sonarr import SonarrClient

logger = logging.getLogger(__name__)


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
            try:
                if not file_path.is_file():
                    continue
                stat = file_path.stat()
                if stat.st_mtime < cutoff:
                    file_path.unlink(missing_ok=True)
                    freed_bytes += stat.st_size
                    deleted_files += 1
            except OSError:
                # A fájl a listázás és a törlés között eltűnhetett — kihagyjuk.
                continue

        return {
            "deleted_files": deleted_files,
            "freed_mb": round(freed_bytes / (1024 * 1024), 2),
            "path": str(cache_path),
        }

    async def list_stale_media(self) -> list[dict[str, Any]]:
        now = datetime.now(UTC)
        cutoff = now - timedelta(days=settings.stale_media_days)

        # Ha van Jellyfin, a TÉNYLEGES nézettséget kérdezzük le (ki mit, mikor
        # nézett) — ez pontosabb "elavult"-jelzés, mint a puszta letöltés-dátum.
        jellyfin = JellyfinClient()
        watched_map: dict[tuple[str, int], datetime] = {}
        have_watch_data = jellyfin.configured
        if have_watch_data:
            try:
                watched_map = await jellyfin.last_watched_map()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Jellyfin nézettség lekérés sikertelen: %s", exc)
                have_watch_data = False

        stale: list[dict[str, Any]] = []

        if self.radarr.configured:
            movies = await self.radarr.list_movies()
            history = await self.radarr.get_history()
            last_download = self._latest_history(history, "movie")
            for movie in movies:
                movie_id = movie.get("id")
                if movie_id is None:
                    continue
                tmdb_id = movie.get("tmdbId")
                item = self._evaluate_stale(
                    title=movie.get("title") or "Ismeretlen film",
                    media_type="movie",
                    arr_id=movie_id,
                    external_id=tmdb_id or 0,
                    on_disk=bool(movie.get("hasFile")),
                    last_download=last_download.get(movie_id),
                    last_watched=watched_map.get(("movie", tmdb_id)) if tmdb_id else None,
                    have_watch_data=have_watch_data,
                    now=now,
                    cutoff=cutoff,
                )
                if item:
                    stale.append(item)

        if self.sonarr.configured:
            series_list = await self.sonarr.list_series()
            history = await self.sonarr.get_history()
            last_download = self._latest_history(history, "series")
            for series in series_list:
                series_id = series.get("id")
                if series_id is None:
                    continue
                tvdb_id = series.get("tvdbId")
                on_disk = int((series.get("statistics") or {}).get("episodeFileCount") or 0) > 0
                item = self._evaluate_stale(
                    title=series.get("title") or "Ismeretlen sorozat",
                    media_type="series",
                    arr_id=series_id,
                    external_id=tvdb_id or 0,
                    on_disk=on_disk,
                    last_download=last_download.get(series_id),
                    last_watched=watched_map.get(("series", tvdb_id)) if tvdb_id else None,
                    have_watch_data=have_watch_data,
                    now=now,
                    cutoff=cutoff,
                )
                if item:
                    stale.append(item)

        # Előre a soha/rég nem nézett (unwatched) tételek, azon belül a
        # leginkább elavult; utánuk a csak letöltés-dátum alapján elavultak.
        def _sort_key(it: dict[str, Any]) -> tuple[int, int]:
            if it["category"] == "unwatched":
                idle = it["watch_days_idle"] if it["watch_days_idle"] is not None else 100_000
            else:
                idle = it["days_idle"] if it["days_idle"] is not None else 100_000
            return (0 if it["category"] == "unwatched" else 1, -idle)

        stale.sort(key=_sort_key)
        return stale

    @staticmethod
    def _evaluate_stale(
        *,
        title: str,
        media_type: Literal["movie", "series"],
        arr_id: int,
        external_id: int,
        on_disk: bool,
        last_download: datetime | None,
        last_watched: datetime | None,
        have_watch_data: bool,
        now: datetime,
        cutoff: datetime,
    ) -> dict[str, Any] | None:
        """Eldönti, elavult-e egy tétel, és melyik kategóriába esik.

        Jellyfinnel: a lemezen lévő, de rég (vagy soha) nem nézett tartalom
        "unwatched" — de a frissen letöltötteket (download-dátum a cutoffon
        belül) még nem soroljuk ide, hogy legyen idő megnézni őket.
        Jellyfin nélkül a régi viselkedés marad: a rég nem mozgatott
        (letöltött/importált) tétel "stale_download"."""
        download_idle = (now - last_download).days if last_download else None
        watch_idle = (now - last_watched).days if last_watched else None

        if have_watch_data:
            watched_recently = last_watched is not None and last_watched >= cutoff
            recently_grabbed = last_download is not None and last_download >= cutoff
            if not on_disk or watched_recently or recently_grabbed:
                return None
            watch_status = "never_watched" if last_watched is None else "not_watched_recently"
            category = "unwatched"
        else:
            if last_download is not None and last_download >= cutoff:
                return None
            watch_status = "no_data"
            category = "stale_download"

        return {
            "title": title,
            "media_type": media_type,
            "external_id": external_id,
            "arr_id": arr_id,
            # A UI eddig a letöltés-inaktivitást mutatta — kompatibilitásból marad.
            "last_activity": last_download.isoformat() if last_download else None,
            "days_idle": download_idle,
            # Új: tényleges nézettségi jelzés (Jellyfinből)
            "category": category,
            "watch_status": watch_status,
            "last_watched": last_watched.isoformat() if last_watched else None,
            "watch_days_idle": watch_idle,
        }

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
