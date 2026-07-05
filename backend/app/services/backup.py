"""Automatikus adatmentés: a felhasználók, konfiguráció-felülírások, tanítófájlok
és beszélgetések exportja egy időbélyeges JSON-fájlba a ./data/backups mappába.
Napi ütemezéssel fut, és kézzel is indítható a Settingsből."""

import asyncio
import json
import logging
from pathlib import Path

from sqlalchemy import select

from app.db.models import ConfigOverride, Conversation, ConversationMessage, User

logger = logging.getLogger(__name__)

BACKUP_DIR = Path("./data/backups")
KEEP_LAST = 14  # csak az utolsó N mentést tartjuk meg
INTERVAL_SECONDS = 24 * 3600
TRAINING_DIR = Path("./data/training")


class BackupService:
    async def create_backup(self, timestamp: str) -> dict:
        """Egy mentés készítése. A timestamp-et a hívó adja (a scriptekben nincs
        Date.now, itt a kérés idejét kapjuk)."""
        from app.db.database import SessionLocal

        async with SessionLocal() as db:
            users = (await db.execute(select(User).where(User.username.is_not(None)))).scalars().all()
            overrides = (await db.execute(select(ConfigOverride))).scalars().all()
            conversations = (await db.execute(select(Conversation))).scalars().all()
            messages = (await db.execute(select(ConversationMessage))).scalars().all()

        data = {
            "version": 1,
            "created_at": timestamp,
            "users": [
                {
                    "id": u.id,
                    "username": u.username,
                    "display_name": u.display_name,
                    "role": u.role,
                    "password_hash": u.password_hash,  # hash — nem plaintext
                }
                for u in users
            ],
            "config_overrides": [{"key": o.key, "value": o.value} for o in overrides],
            "conversations": [
                {"id": c.id, "user_id": c.user_id, "title": c.title} for c in conversations
            ],
            "messages": [
                {
                    "conversation_id": m.conversation_id,
                    "role": m.role,
                    "content": m.content,
                    "action": m.action,
                    "payload": m.payload,
                }
                for m in messages
            ],
            "training_files": self._read_training_files(),
        }

        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        safe_ts = timestamp.replace(":", "-").replace(".", "-")
        path = BACKUP_DIR / f"backup-{safe_ts}.json"
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        self._prune()
        logger.info("Adatmentés kész: %s (%d felhasználó, %d beszélgetés)", path.name, len(users), len(conversations))
        return {"file": path.name, "size_bytes": path.stat().st_size, "users": len(users), "conversations": len(conversations)}

    def list_backups(self) -> list[dict]:
        if not BACKUP_DIR.exists():
            return []
        entries = []
        for f in sorted(BACKUP_DIR.glob("backup-*.json"), reverse=True):
            stat = f.stat()
            entries.append({"file": f.name, "size_bytes": stat.st_size, "mtime": int(stat.st_mtime)})
        return entries

    @staticmethod
    def _read_training_files() -> dict[str, str]:
        files: dict[str, str] = {}
        if TRAINING_DIR.exists():
            for f in TRAINING_DIR.iterdir():
                if f.is_file():
                    try:
                        files[f.name] = f.read_text(encoding="utf-8")
                    except OSError:
                        continue
        return files

    @staticmethod
    def _prune() -> None:
        backups = sorted(BACKUP_DIR.glob("backup-*.json"), reverse=True)
        for old in backups[KEEP_LAST:]:
            try:
                old.unlink()
            except OSError:
                pass

    async def run_loop(self) -> None:
        # Az első mentés indulás után 1 perccel, utána naponta.
        from datetime import datetime, UTC

        await asyncio.sleep(60)
        while True:
            try:
                await self.create_backup(datetime.now(UTC).isoformat(timespec="seconds"))
            except Exception:  # noqa: BLE001
                logger.exception("Automatikus mentés hibával állt le")
            await asyncio.sleep(INTERVAL_SECONDS)
