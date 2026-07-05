"""Befejezett torrentek automatikus törlése N órával a letöltés után.

A háttérciklus 10 percenként fut; a settings-et minden körben frissen
olvassa, így a UI-ból mentett konfiguráció újraindítás nélkül érvényesül.
Minden törlés a torrent_cleanup_log táblába kerül.
"""

import asyncio
import logging
import time

from sqlalchemy import select

from app.config import settings
from app.db.models import TorrentCleanupLog
from app.services.torrents import TorrentError, TorrentService

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 600  # 10 perc
LOG_LIMIT = 100


class TorrentCleanupService:
    def __init__(self, torrents: TorrentService) -> None:
        self.torrents = torrents

    async def run_loop(self) -> None:
        while True:
            try:
                await self.run_once()
            except Exception:  # noqa: BLE001
                logger.exception("Torrent cleanup kör hibával állt le")
            await asyncio.sleep(CHECK_INTERVAL_SECONDS)

    async def run_once(self) -> int:
        """Egy takarítási kör; a törölt torrentek számát adja vissza."""
        hours = settings.torrent_auto_delete_hours
        if hours <= 0 or not self.torrents.configured:
            return 0

        try:
            items = await self.torrents.list_torrents()
        except (TorrentError, Exception) as exc:  # noqa: BLE001
            logger.warning("Torrent cleanup: a kliens nem érhető el: %s", exc)
            return 0

        cutoff = time.time() - hours * 3600
        deleted = 0
        for item in items:
            completed_at = item.get("completedAt")
            if not completed_at or completed_at > cutoff:
                continue
            try:
                await self.delete_and_log(item, mode="auto")
                deleted += 1
            except TorrentError as exc:
                logger.warning("Torrent cleanup: %r törlése sikertelen: %s", item.get("name"), exc)
        if deleted:
            logger.info("Torrent cleanup: %d befejezett torrent törölve (>%d óra).", deleted, hours)
        return deleted

    async def delete_and_log(self, item: dict, mode: str, delete_files: bool | None = None) -> None:
        from app.db.database import SessionLocal

        if delete_files is None:
            delete_files = settings.torrent_auto_delete_files
        await self.torrents.delete_torrent(item["id"], delete_files)
        async with SessionLocal() as db:
            db.add(
                TorrentCleanupLog(
                    torrent_id=str(item.get("id") or ""),
                    name=str(item.get("name") or "Ismeretlen torrent"),
                    mode=mode,
                    size_bytes=int(item.get("sizeBytes") or 0),
                )
            )
            await db.commit()
        logger.info("Torrent törölve (%s): %s", mode, item.get("name"))

    @staticmethod
    async def recent_log(db, limit: int = LOG_LIMIT) -> list[TorrentCleanupLog]:
        result = await db.execute(
            select(TorrentCleanupLog).order_by(TorrentCleanupLog.deleted_at.desc()).limit(limit)
        )
        return list(result.scalars().all())
