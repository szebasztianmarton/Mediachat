"""Futásidejű konfiguráció-felülírások: a Settings oldal admin-védett config
API-jának háttere. Az env marad az alap, a DB-ben tárolt felülírások
induláskor és mentéskor rákerülnek a settings objektumra."""

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import ConfigOverride

logger = logging.getLogger(__name__)

# A UI-ból szerkeszthető kulcsok. Minden érték string a Settings modellben.
EDITABLE_KEYS: frozenset[str] = frozenset(
    {
        "sonarr_url",
        "sonarr_api_key",
        "radarr_url",
        "radarr_api_key",
        "ollama_base_url",
        "ollama_model",
        "tmdb_api_key",
        "torrent_client",
        "torrent_url",
        "torrent_username",
        "torrent_password",
        "plex_url",
        "plex_token",
        "jellyfin_url",
        "jellyfin_api_key",
        "max_series_quality",
    }
)

# Ezeket sosem adjuk vissza teljes értékkel — csak maszkolva.
SECRET_KEYS: frozenset[str] = frozenset(
    {
        "sonarr_api_key",
        "radarr_api_key",
        "tmdb_api_key",
        "torrent_password",
        "plex_token",
        "jellyfin_api_key",
    }
)

# Korábbi kulcsnevek → újak (a DB-ben ragadt régi felülírások miatt).
_LEGACY_KEY_MAP = {
    "qbittorrent_url": "torrent_url",
    "qbittorrent_username": "torrent_username",
    "qbittorrent_password": "torrent_password",
}


def mask_secret(value: str) -> str | None:
    if not value:
        return None
    return f"****{value[-4:]}" if len(value) > 4 else "****"


async def load_overrides(db: AsyncSession) -> dict[str, str]:
    result = await db.execute(select(ConfigOverride))
    overrides: dict[str, str] = {}
    for row in result.scalars().all():
        key = _LEGACY_KEY_MAP.get(row.key, row.key)
        if key in EDITABLE_KEYS and key not in overrides:
            overrides[key] = row.value
    return overrides


async def save_overrides(db: AsyncSession, values: dict[str, str]) -> None:
    for key, value in values.items():
        if key not in EDITABLE_KEYS:
            continue
        existing = await db.get(ConfigOverride, key)
        if existing is None:
            db.add(ConfigOverride(key=key, value=value, updated_at=datetime.now(UTC)))
        else:
            existing.value = value
            existing.updated_at = datetime.now(UTC)
    await db.commit()


def apply_to_settings(values: dict[str, str]) -> None:
    for key, value in values.items():
        if key in EDITABLE_KEYS:
            setattr(settings, key, value)
    if values:
        logger.info("Konfiguráció-felülírások alkalmazva: %s", ", ".join(sorted(values)))


def config_view() -> dict:
    """A jelenlegi effektív konfiguráció — a titkok maszkolva."""
    values: dict[str, str] = {}
    secrets: dict[str, str | None] = {}
    for key in sorted(EDITABLE_KEYS):
        current = getattr(settings, key, "") or ""
        if key in SECRET_KEYS:
            secrets[key] = mask_secret(current)
        else:
            values[key] = current
    return {"values": values, "secrets": secrets}
