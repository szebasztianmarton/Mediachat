import asyncio
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import AddJob
from app.services.search import SearchService


class QueueService:
    def __init__(self, search_service: SearchService) -> None:
        self.search_service = search_service
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._workers: list[asyncio.Task] = []
        self._running = False

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        for _ in range(settings.queue_max_workers):
            self._workers.append(asyncio.create_task(self._worker()))

    async def stop(self) -> None:
        self._running = False
        for task in self._workers:
            task.cancel()
        self._workers.clear()

    async def enqueue_add(
        self,
        db: AsyncSession,
        user_id: str,
        media_type: Literal["movie", "series"],
        external_id: int,
        title: str,
        tmdb_id: int | None = None,
    ) -> AddJob:
        job = AddJob(
            user_id=user_id,
            media_type=media_type,
            external_id=external_id,
            tmdb_id=tmdb_id,
            title=title,
            status="queued",
        )
        db.add(job)
        await db.commit()
        await db.refresh(job)
        await self._queue.put(job.id)
        return job

    async def get_job(self, db: AsyncSession, job_id: str) -> AddJob | None:
        result = await db.execute(select(AddJob).where(AddJob.id == job_id))
        return result.scalar_one_or_none()

    async def _worker(self) -> None:
        from app.db.database import SessionLocal

        while self._running:
            try:
                job_id = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            except TimeoutError:
                continue

            async with SessionLocal() as db:
                job = await self.get_job(db, job_id)
                if job is None or job.status != "queued":
                    continue
                job.status = "processing"
                await db.commit()

                try:
                    added_title, quality_note = await self.search_service.add(
                        media_type=job.media_type,  # type: ignore[arg-type]
                        external_id=job.external_id,
                        title=job.title,
                        tmdb_id=job.tmdb_id,
                    )
                    job.status = "completed"
                    job.message = quality_note or f"{added_title} hozzáadva."
                    await self.search_service.record_event(
                        db,
                        job.user_id,
                        job.media_type,
                        job.external_id,
                        added_title,
                        "added",
                        tmdb_id=job.tmdb_id,
                    )
                except Exception as exc:  # noqa: BLE001
                    job.status = "failed"
                    job.message = str(exc)
                job.finished_at = datetime.now(UTC)
                await db.commit()
