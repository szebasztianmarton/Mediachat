import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes, MessageHandler, filters

from app.config import settings
from app.state import app_state

logger = logging.getLogger(__name__)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message:
        await update.message.reply_text(
            "Szia! Írj egy film vagy sorozat címét, vagy írd le, mit keresel."
        )


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if app_state is None or update.message is None:
        return

    query = update.message.text.strip()
    await update.message.reply_text("Keresés folyamatban...")
    try:
        results, _, search_mode = await app_state.search.search(query, mode="auto")
    except Exception as exc:  # noqa: BLE001
        await update.message.reply_text(f"Hiba: {exc}")
        return

    if not results:
        await update.message.reply_text("Nincs találat.")
        return

    buttons = []
    for result in results[:5]:
        label = f"{result.title} ({'Film' if result.media_type == 'movie' else 'Sorozat'})"
        # Telegram callback_data limit: 64 bytes
        # "add:series:1234567890:1234567890:" = 33 chars fixed → title max 30 chars
        safe_title = result.title.replace(":", " ")[:30]
        callback = f"add:{result.media_type}:{result.external_id}:{result.tmdb_id or 0}:{safe_title}"
        buttons.append([InlineKeyboardButton(label, callback_data=callback)])

    await update.message.reply_text(
        f"Találatok ({search_mode} keresés):",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def handle_add(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if app_state is None or update.callback_query is None:
        return

    query = update.callback_query
    await query.answer()
    parts = (query.data or "").split(":", 4)
    if len(parts) != 5 or parts[0] != "add":
        await query.edit_message_text("Érvénytelen művelet.")
        return

    _, media_type, external_id, tmdb_id, title = parts
    try:
        added_title, note = await app_state.search.add(
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
    application = (
        Application.builder()
        .token(settings.telegram_bot_token)
        .build()
    )
    application.add_handler(CommandHandler("start", start))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    application.add_handler(CallbackQueryHandler(handle_add, pattern=r"^add:"))

    logger.info("Telegram bot started")
    await application.run_polling(stop_signals=None)
