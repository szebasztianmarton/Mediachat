import asyncio
import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes, MessageHandler, filters

from app import state
from app.config import settings

logger = logging.getLogger(__name__)

# A futó Telegram Application referenciája — az értesítés-küldés ezen keresztül megy.
_application = None


def _notify_chat_ids() -> list[int]:
    if settings.telegram_notify_chat_id.strip():
        raw = settings.telegram_notify_chat_id
    else:
        raw = settings.telegram_allowed_chat_ids
    ids: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if part.lstrip("-").isdigit():
            ids.append(int(part))
    return ids


async def send_telegram_notification(text: str) -> bool:
    """Értesítés küldése a beállított Telegram chat(ek)be. True, ha legalább
    egy kézbesítés sikerült."""
    if _application is None:
        return False
    chat_ids = _notify_chat_ids()
    if not chat_ids:
        logger.warning("Telegram értesítés: nincs cél chat ID (TELEGRAM_NOTIFY_CHAT_ID / allowlist).")
        return False
    sent = False
    for chat_id in chat_ids:
        try:
            await _application.bot.send_message(chat_id=chat_id, text=text)
            sent = True
        except Exception as exc:  # noqa: BLE001
            logger.warning("Telegram értesítés kézbesítése sikertelen (%s): %s", chat_id, exc)
    return sent

# Telegram callback_data limit: 64 bájt (nem karakter — az ékezetes betűk
# UTF-8-ban többájtosak).
_CALLBACK_MAX_BYTES = 64


def _allowed_chat_ids() -> set[int]:
    raw = settings.telegram_allowed_chat_ids.strip()
    if not raw:
        return set()
    ids: set[int] = set()
    for part in raw.split(","):
        part = part.strip()
        if part.lstrip("-").isdigit():
            ids.add(int(part))
    return ids


def _chat_allowed(chat_id: int | None) -> bool:
    allowed = _allowed_chat_ids()
    if not allowed:
        return True  # nincs allowlist beállítva — minden chat engedélyezett
    return chat_id is not None and chat_id in allowed


def _truncate_bytes(text: str, max_bytes: int) -> str:
    if max_bytes <= 0:
        return ""
    encoded = text.encode("utf-8")[:max_bytes]
    return encoded.decode("utf-8", errors="ignore")


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    if not _chat_allowed(update.effective_chat.id if update.effective_chat else None):
        logger.warning("Telegram: nem engedélyezett chat: %s", update.effective_chat)
        return
    await update.message.reply_text(
        "Szia! Írj egy film vagy sorozat címét, vagy írd le, mit keresel."
    )


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if state.app_state is None or update.message is None:
        return
    if not _chat_allowed(update.effective_chat.id if update.effective_chat else None):
        logger.warning("Telegram: nem engedélyezett chat próbált keresni: %s", update.effective_chat)
        return

    query = update.message.text.strip()
    await update.message.reply_text("Keresés folyamatban...")
    try:
        results, _, search_mode = await state.app_state.search.search(query, mode="auto")
    except Exception as exc:  # noqa: BLE001
        await update.message.reply_text(f"Hiba: {exc}")
        return

    if not results:
        await update.message.reply_text("Nincs találat.")
        return

    buttons = []
    for result in results[:5]:
        label = f"{result.title} ({'Film' if result.media_type == 'movie' else 'Sorozat'})"
        prefix = f"add:{result.media_type}:{result.external_id}:{result.tmdb_id or 0}:"
        safe_title = _truncate_bytes(
            result.title.replace(":", " "),
            _CALLBACK_MAX_BYTES - len(prefix.encode("utf-8")),
        )
        buttons.append([InlineKeyboardButton(label, callback_data=prefix + safe_title)])

    await update.message.reply_text(
        f"Találatok ({search_mode} keresés):",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def handle_add(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if state.app_state is None or update.callback_query is None:
        return
    if not _chat_allowed(update.effective_chat.id if update.effective_chat else None):
        logger.warning("Telegram: nem engedélyezett chat próbált hozzáadni.")
        return

    query = update.callback_query
    await query.answer()
    parts = (query.data or "").split(":", 4)
    if len(parts) != 5 or parts[0] != "add":
        await query.edit_message_text("Érvénytelen művelet.")
        return

    _, media_type, external_id, tmdb_id, title = parts
    try:
        added_title, note = await state.app_state.search.add(
            media_type=media_type,  # type: ignore[arg-type]
            external_id=int(external_id),
            title=title,
            tmdb_id=int(tmdb_id) or None,
        )
    except Exception as exc:  # noqa: BLE001
        await query.edit_message_text(f"Hiba: {exc}")
        return

    extra = f" {note}" if note else ""
    await query.edit_message_text(f"✅ {added_title} hozzáadva.{extra}")


async def run_telegram_bot() -> None:
    global _application
    application = (
        Application.builder()
        .token(settings.telegram_bot_token)
        .build()
    )
    application.add_handler(CommandHandler("start", start))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    application.add_handler(CallbackQueryHandler(handle_add, pattern=r"^add:"))

    # run_polling() saját event loopot kezelne, ami a futó FastAPI loopban
    # kivételt dob — helyette a manuális initialize/start/start_polling minta.
    await application.initialize()
    await application.start()
    await application.updater.start_polling()
    _application = application
    if not _allowed_chat_ids():
        logger.warning(
            "Telegram bot allowlist nélkül fut — bárki használhatja. "
            "Állítsd be a TELEGRAM_ALLOWED_CHAT_IDS env-változót."
        )
    logger.info("Telegram bot started")
    try:
        await asyncio.Event().wait()  # fut, amíg a lifespan le nem állítja a taskot
    finally:
        _application = None
        await application.updater.stop()
        await application.stop()
        await application.shutdown()
