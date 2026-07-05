import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class TorrentError(Exception):
    pass


# qBittorrent állapot → frontend TorrentItem.state
_QBT_STATE_MAP: dict[str, str] = {
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

# Transmission status kód → frontend TorrentItem.state
_TRANSMISSION_STATE_MAP: dict[int, str] = {
    0: "paused",       # stopped
    1: "queued",       # check pending
    2: "queued",       # checking
    3: "queued",       # download pending
    4: "downloading",
    5: "queued",       # seed pending
    6: "seeding",
}


class QbittorrentClient:
    def __init__(self) -> None:
        self.base_url = settings.torrent_url.rstrip("/")
        self.username = settings.torrent_username
        self.password = settings.torrent_password

    async def list_torrents(self) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if self.username:
                login = await client.post(
                    f"{self.base_url}/api/v2/auth/login",
                    data={"username": self.username, "password": self.password},
                )
                if login.status_code != 200 or login.text.strip() != "Ok.":
                    raise TorrentError("qBittorrent bejelentkezés sikertelen (felhasználónév/jelszó).")
            response = await client.get(f"{self.base_url}/api/v2/torrents/info")
            if response.status_code == 403:
                raise TorrentError("qBittorrent hozzáférés megtagadva (auth szükséges).")
            response.raise_for_status()
            return [self._to_item(t) for t in response.json()]

    async def delete_torrent(self, torrent_id: str, delete_files: bool) -> None:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if self.username:
                await client.post(
                    f"{self.base_url}/api/v2/auth/login",
                    data={"username": self.username, "password": self.password},
                )
            response = await client.post(
                f"{self.base_url}/api/v2/torrents/delete",
                data={"hashes": torrent_id, "deleteFiles": str(delete_files).lower()},
            )
            if response.status_code >= 400:
                raise TorrentError(f"qBittorrent törlés sikertelen: HTTP {response.status_code}")

    @staticmethod
    def _to_item(t: dict[str, Any]) -> dict[str, Any]:
        completion = int(t.get("completion_on") or 0)
        return {
            "id": t.get("hash") or t.get("name") or "",
            "name": t.get("name") or "Ismeretlen torrent",
            "progressPercent": round(float(t.get("progress") or 0) * 100),
            "dlSpeed": int(t.get("dlspeed") or 0),
            "state": _QBT_STATE_MAP.get(str(t.get("state") or ""), "queued"),
            "sizeBytes": int(t.get("size") or 0),
            # Unix timestamp, ha a letöltés befejeződött (auto-törléshez)
            "completedAt": completion if completion > 0 else None,
        }


class TransmissionClient:
    """Transmission RPC kliens (X-Transmission-Session-Id kézfogással)."""

    def __init__(self) -> None:
        self.base_url = settings.torrent_url.rstrip("/")
        self.username = settings.torrent_username
        self.password = settings.torrent_password

    def _auth(self) -> tuple[str, str] | None:
        return (self.username, self.password) if self.username else None

    async def _rpc(self, body: dict[str, Any]) -> dict[str, Any]:
        rpc_url = f"{self.base_url}/transmission/rpc"
        async with httpx.AsyncClient(timeout=10.0, auth=self._auth()) as client:
            response = await client.post(rpc_url, json=body)
            if response.status_code == 409:
                # Első kérés: session ID-t kapunk, azzal ismételjük.
                session_id = response.headers.get("X-Transmission-Session-Id", "")
                response = await client.post(
                    rpc_url, json=body, headers={"X-Transmission-Session-Id": session_id}
                )
            if response.status_code == 401:
                raise TorrentError("Transmission bejelentkezés sikertelen (felhasználónév/jelszó).")
            response.raise_for_status()
            data = response.json()
            if data.get("result") != "success":
                raise TorrentError(f"Transmission RPC hiba: {data.get('result')}")
            return data

    async def list_torrents(self) -> list[dict[str, Any]]:
        data = await self._rpc({
            "method": "torrent-get",
            "arguments": {
                "fields": [
                    "hashString", "name", "percentDone", "rateDownload",
                    "status", "totalSize", "error", "doneDate",
                ],
            },
        })
        torrents = (data.get("arguments") or {}).get("torrents") or []
        return [self._to_item(t) for t in torrents]

    async def delete_torrent(self, torrent_id: str, delete_files: bool) -> None:
        await self._rpc({
            "method": "torrent-remove",
            "arguments": {"ids": [torrent_id], "delete-local-data": delete_files},
        })

    @staticmethod
    def _to_item(t: dict[str, Any]) -> dict[str, Any]:
        state = "error" if t.get("error") else _TRANSMISSION_STATE_MAP.get(int(t.get("status") or 0), "queued")
        done_date = int(t.get("doneDate") or 0)
        return {
            "id": t.get("hashString") or t.get("name") or "",
            "name": t.get("name") or "Ismeretlen torrent",
            "progressPercent": round(float(t.get("percentDone") or 0) * 100),
            "dlSpeed": int(t.get("rateDownload") or 0),
            "state": state,
            "sizeBytes": int(t.get("totalSize") or 0),
            "completedAt": done_date if done_date > 0 else None,
        }


class TorrentService:
    """A beállított kliens-típus (qbittorrent | transmission) szerint delegál."""

    @property
    def configured(self) -> bool:
        return bool(settings.torrent_url)

    @property
    def client_type(self) -> str:
        return (settings.torrent_client or "qbittorrent").strip().lower()

    def _client(self) -> QbittorrentClient | TransmissionClient:
        if self.client_type == "transmission":
            return TransmissionClient()
        return QbittorrentClient()

    async def list_torrents(self) -> list[dict[str, Any]]:
        if not self.configured:
            return []
        return await self._client().list_torrents()

    async def delete_torrent(self, torrent_id: str, delete_files: bool) -> None:
        if not self.configured:
            raise TorrentError("Nincs torrent kliens konfigurálva.")
        await self._client().delete_torrent(torrent_id, delete_files)
