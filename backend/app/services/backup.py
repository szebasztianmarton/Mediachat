"""Automatikus adatmentés: a felhasználók, konfiguráció-felülírások, tanítófájlok
és beszélgetések exportja egy időbélyeges JSON-fájlba a ./data/backups mappába.
Napi ütemezéssel fut, és kézzel is indítható a Settingsből."""

import asyncio
import json
import logging
from pathlib import Path

from sqlalchemy import delete, select

from app.config import settings
from app.db.models import (
    AddJob,
    ConfigOverride,
    Conversation,
    ConversationMessage,
    MediaEvent,
    User,
    UserSession,
    WebauthnCredential,
)

logger = logging.getLogger(__name__)

BACKUP_DIR = Path("./data/backups")
KEEP_LAST = 14  # fallback, ha a settings.backup_keep_last valamiért nem elérhető
INTERVAL_SECONDS = 24 * 3600  # fallback, ld. settings.backup_interval_hours
TRAINING_DIR = Path("./data/training")


class BackupRestoreError(ValueError):
    pass


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
        keep_last = settings.backup_keep_last or KEEP_LAST
        backups = sorted(BACKUP_DIR.glob("backup-*.json"), reverse=True)
        for old in backups[keep_last:]:
            try:
                old.unlink()
            except OSError:
                pass

    async def run_loop(self) -> None:
        # Az első mentés indulás után 1 perccel, utána settings.backup_interval_hours
        # szerint — minden ciklusban újraolvasva, hogy futás közbeni configváltás
        # (Beállítások oldal) is érvényesüljön újraindítás nélkül.
        from datetime import datetime, UTC

        await asyncio.sleep(60)
        while True:
            try:
                await self.create_backup(datetime.now(UTC).isoformat(timespec="seconds"))
            except Exception:  # noqa: BLE001
                logger.exception("Automatikus mentés hibával állt le")
            interval_seconds = (settings.backup_interval_hours or 24) * 3600
            await asyncio.sleep(interval_seconds)

    @staticmethod
    def _read_backup_file(filename: str) -> dict:
        safe_name = Path(filename).name
        path = BACKUP_DIR / safe_name
        if not safe_name.startswith("backup-") or not path.is_file():
            raise BackupRestoreError(f"Nem található mentés: {filename!r}")
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise BackupRestoreError(f"A mentés-fájl nem olvasható: {exc}") from exc

    async def preview_restore(self, filename: str) -> dict:
        """Diffet ad a mentésben tárolt és a JELENLEGI adatbázis-állapot között,
        MIELŐTT a destruktív restore_backup lefutna — hogy a Beállítások oldal
        ne vakon, hanem tényleges számok alapján kérjen megerősítést."""
        from app.db.database import SessionLocal

        data = self._read_backup_file(filename)

        async with SessionLocal() as db:
            current_users = (await db.execute(select(User).where(User.username.is_not(None)))).scalars().all()
            current_conversations = (await db.execute(select(Conversation))).scalars().all()
            current_messages = (await db.execute(select(ConversationMessage))).scalars().all()
            current_overrides = (await db.execute(select(ConfigOverride))).scalars().all()

        return {
            "file": Path(filename).name,
            "created_at": data.get("created_at"),
            "current": {
                "users": len(current_users),
                "conversations": len(current_conversations),
                "messages": len(current_messages),
                "config_overrides": len(current_overrides),
            },
            "backup": {
                "users": len(data.get("users", [])),
                "conversations": len(data.get("conversations", [])),
                "messages": len(data.get("messages", [])),
                "config_overrides": len(data.get("config_overrides", [])),
                "training_files": len(data.get("training_files", {})),
            },
        }

    async def restore_backup(self, filename: str) -> dict:
        """Egy korábbi mentés visszaállítása. DESTRUKTÍV: a jelenlegi
        felhasználókat, beszélgetéseket, config-felülírásokat és tanítófájlokat
        felülírja a mentésben tárolt állapottal, és minden bejelentkezett
        session-t érvénytelenít (a user-tábla cseréje miatt mindenkinek újra
        be kell jelentkeznie)."""
        from app.db.database import SessionLocal
        from app.services import config_store

        safe_name = Path(filename).name
        data = self._read_backup_file(filename)

        async with SessionLocal() as db:
            # Gyerek-táblák előbb (FK-integritás Postgres alatt is). A
            # passkey-k (webauthn_credentials) nincsenek a mentésben — a
            # restore törli őket, tehát mindenkinek újra kell regisztrálnia
            # a passkey-jét a visszaállítás után (ugyanúgy, mint a jelszavas
            # session-ök esetén).
            await db.execute(delete(ConversationMessage))
            await db.execute(delete(MediaEvent))
            await db.execute(delete(AddJob))
            await db.execute(delete(WebauthnCredential))
            await db.execute(delete(UserSession))
            await db.execute(delete(Conversation))
            await db.execute(delete(User))
            await db.execute(delete(ConfigOverride))

            for u in data.get("users", []):
                db.add(User(
                    id=u["id"],
                    username=u.get("username"),
                    display_name=u.get("display_name", "Felhasználó"),
                    password_hash=u.get("password_hash"),
                    role=u.get("role", "user"),
                ))
            for c in data.get("conversations", []):
                db.add(Conversation(id=c["id"], user_id=c["user_id"], title=c.get("title", "Új beszélgetés")))
            for m in data.get("messages", []):
                db.add(ConversationMessage(
                    conversation_id=m["conversation_id"],
                    role=m.get("role", "user"),
                    content=m.get("content", ""),
                    action=m.get("action"),
                    payload=m.get("payload"),
                ))
            overrides = data.get("config_overrides", [])
            for o in overrides:
                db.add(ConfigOverride(key=o["key"], value=o.get("value", "")))

            await db.commit()

        training_files = data.get("training_files", {})
        if training_files:
            TRAINING_DIR.mkdir(parents=True, exist_ok=True)
            for fname, content in training_files.items():
                try:
                    (TRAINING_DIR / Path(fname).name).write_text(content, encoding="utf-8")
                except OSError:
                    logger.warning("Nem sikerült visszaírni a tanítófájlt: %s", fname)

        config_store.apply_to_settings({o["key"]: o.get("value", "") for o in overrides})

        summary = {
            "file": safe_name,
            "users": len(data.get("users", [])),
            "conversations": len(data.get("conversations", [])),
            "messages": len(data.get("messages", [])),
            "config_overrides": len(overrides),
            "training_files": len(training_files),
        }
        logger.warning("Adat-visszaállítás megtörtént: %s — minden session érvénytelenítve", safe_name)
        return summary
