"""Értesítés-szolgáltatás: a letöltés-kész (és rendszer-) értesítéseket
elküldi a beállított Telegram/Discord botoknak, és naplózza a DB-be."""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import Notification

logger = logging.getLogger(__name__)

LOG_LIMIT = 100


class NotificationService:
    async def dispatch(self, title: str, body: str = "", kind: str = "download") -> list[str]:
        """Elküldi az értesítést minden elérhető csatornán, és naplózza.
        Visszaadja a sikeres csatornák listáját."""
        text = f"🎬 {title}" if kind == "download" else title
        if body:
            text = f"{text}\n{body}"

        delivered: list[str] = []

        if settings.telegram_enabled:
            try:
                from app.bots.telegram_bot import send_telegram_notification

                if await send_telegram_notification(text):
                    delivered.append("telegram")
            except Exception as exc:  # noqa: BLE001
                logger.warning("Telegram értesítés hiba: %s", exc)

        if settings.discord_enabled:
            try:
                from app.bots.discord_bot import send_discord_notification

                if await send_discord_notification(text):
                    delivered.append("discord")
            except Exception as exc:  # noqa: BLE001
                logger.warning("Discord értesítés hiba: %s", exc)

        from app.db.database import SessionLocal

        async with SessionLocal() as db:
            db.add(
                Notification(
                    kind=kind,
                    title=title,
                    body=body,
                    delivered=",".join(delivered),
                )
            )
            await db.commit()

        logger.info("Értesítés: %r → %s", title, delivered or "csak napló")
        return delivered

    @staticmethod
    async def recent(db: AsyncSession, limit: int = LOG_LIMIT) -> list[Notification]:
        result = await db.execute(
            select(Notification).order_by(Notification.created_at.desc()).limit(limit)
        )
        return list(result.scalars().all())
