import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class QbittorrentError(Exception):
    pass


# qBittorrent állapot → frontend TorrentItem.state
_STATE_MAP: dict[str, str] = {
    "downloading": "downloading",
    "forcedDL": "downloading",
    "metaDL": "downloading",
    "stalledDL": "downloading",
    "allocating": "downloading",
    "checkingDL": "downloading",
    "uploading": "seeding",
    "forcedUP": "seeding",
    "stalledUP": "seeding",
    "checkingUP": "seeding",
    "pausedDL": "paused",
    "pausedUP": "paused",
    "stoppedDL": "paused",
    "stoppedUP": "paused",
    "queuedDL": "queued",
    "queuedUP": "queued",
    "checkingResumeData": "queued",
    "moving": "queued",
    "error": "error",
    "missingFiles": "error",
}


class QbittorrentClient:
    def __init__(self) -> None:
        self.base_url = settings.qbittorrent_url.rstrip("/")
        self.username = settings.qbittorrent_username
        self.password = settings.qbittorrent_password

    @property
    def configured(self) -> bool:
        return bool(self.base_url)

    async def list_torrents(self) -> list[dict[str, Any]]:
        if not self.configured:
            return []
        async with httpx.AsyncClient(timeout=10.0) as client:
            if self.username:
                login = await client.post(
                    f"{self.base_url}/api/v2/auth/login",
                    data={"username": self.username, "password": self.password},
                )
                if login.status_code != 200 or login.text.strip() != "Ok.":
                    raise QbittorrentError("qBittorrent bejelentkezés sikertelen (felhasználónév/jelszó).")
            response = await client.get(f"{self.base_url}/api/v2/torrents/info")
            if response.status_code == 403:
                raise QbittorrentError("qBittorrent hozzáférés megtagadva (auth szükséges).")
            response.raise_for_status()
            return [self._to_item(t) for t in response.json()]

    @staticmethod
    def _to_item(t: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": t.get("hash") or t.get("name") or "",
            "name": t.get("name") or "Ismeretlen torrent",
            "progressPercent": round(float(t.get("progress") or 0) * 100),
            "dlSpeed": int(t.get("dlspeed") or 0),
            "state": _STATE_MAP.get(str(t.get("state") or ""), "queued"),
            "sizeBytes": int(t.get("size") or 0),
        }
