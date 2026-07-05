import time


def _headers(token: str) -> dict[str, str]:
    return {"X-Session-Token": token}


def test_stats_endpoint(client, admin_token):
    res = client.get("/api/stats", headers=_headers(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert body["users"] >= 1  # legalább az admin létezik
    assert "library" in body and "adds_by_day" in body and "jobs" in body
    # Nem konfigurált Sonarr/Radarr/torrent → None, nem hiba
    assert body["library"]["movies"] is None
    assert body["torrents"] is None


def test_stats_requires_admin(client, admin_token):
    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "dave", "password": "dave1234", "role": "user"},
    )
    dave_token = client.post(
        "/api/auth/login", json={"username": "dave", "password": "dave1234"}
    ).json()["token"]
    assert client.get("/api/stats", headers=_headers(dave_token)).status_code == 403


def test_torrent_cleanup_log_endpoint(client, admin_token):
    res = client.get("/api/torrents/cleanup/log", headers=_headers(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert isinstance(body["entries"], list)
    assert body["auto_delete_hours"] == 0


def test_torrent_delete_requires_configured_client(client, admin_token):
    res = client.delete("/api/torrents/abc123", headers=_headers(admin_token))
    assert res.status_code == 400  # nincs torrent kliens konfigurálva


def test_cleanup_run_once_noop_when_disabled():
    """Auto-delete kikapcsolva (0 óra) → a kör nem csinál semmit."""
    import asyncio

    from app.services.torrent_cleanup import TorrentCleanupService
    from app.services.torrents import TorrentService

    service = TorrentCleanupService(TorrentService())
    assert asyncio.run(service.run_once()) == 0


def test_torrent_item_mapping_completed_at():
    from app.services.torrents import QbittorrentClient, TransmissionClient

    qbt = QbittorrentClient._to_item({
        "hash": "h1", "name": "t", "progress": 1.0, "dlspeed": 0,
        "state": "uploading", "size": 100, "completion_on": int(time.time()),
    })
    assert qbt["state"] == "seeding"
    assert qbt["completedAt"] is not None

    tr = TransmissionClient._to_item({
        "hashString": "h2", "name": "t2", "percentDone": 0.5, "rateDownload": 1000,
        "status": 4, "totalSize": 200, "doneDate": 0,
    })
    assert tr["state"] == "downloading"
    assert tr["completedAt"] is None
