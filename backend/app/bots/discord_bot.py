import logging

import discord

from app import state
from app.config import settings

logger = logging.getLogger(__name__)


def _allowed_guild_ids() -> set[int]:
    raw = settings.discord_allowed_guild_ids.strip()
    if not raw:
        return set()
    ids: set[int] = set()
    for part in raw.split(","):
        part = part.strip()
        if part.isdigit():
            ids.add(int(part))
    return ids


def _guild_allowed(message: discord.Message) -> bool:
    allowed = _allowed_guild_ids()
    if not allowed:
        return True  # nincs allowlist beállítva — minden szerver engedélyezett
    return message.guild is not None and message.guild.id in allowed


class MediaBot(discord.Client):
    async def on_ready(self) -> None:
        if not _allowed_guild_ids():
            logger.warning(
                "Discord bot allowlist nélkül fut — bármelyik szerveren használható. "
                "Állítsd be a DISCORD_ALLOWED_GUILD_IDS env-változót."
            )
        logger.info("Discord bot logged in as %s", self.user)

    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot or state.app_state is None:
            return
        if not message.content.startswith("!search "):
            return
        if not _guild_allowed(message):
            logger.warning("Discord: nem engedélyezett szerverről érkezett kérés: %s", message.guild)
            return

        query = message.content.removeprefix("!search ").strip()
        if not query:
            await message.channel.send("Használat: `!search <cím vagy leírás>`")
            return

        await message.channel.send("Keresés folyamatban...")
        try:
            results, _, search_mode = await state.app_state.search.search(query, mode="auto")
        except Exception as exc:  # noqa: BLE001
            await message.channel.send(f"Hiba: {exc}")
            return

        if not results:
            await message.channel.send("Nincs találat.")
            return

        lines = [f"**Találatok ({search_mode}):**"]
        for index, result in enumerate(results[:5], start=1):
            kind = "Film" if result.media_type == "movie" else "Sorozat"
            lines.append(f"{index}. {result.title} ({kind}) — {int(result.match_score * 100)}%")
        lines.append("A hozzáadáshoz használd a webes felületet vagy a Telegram botot.")
        await message.channel.send("\n".join(lines))


async def run_discord_bot() -> None:
    intents = discord.Intents.default()
    intents.message_content = True
    client = MediaBot(intents=intents)
    await client.start(settings.discord_bot_token)
