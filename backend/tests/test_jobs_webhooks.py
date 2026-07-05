def _headers(token: str) -> dict[str, str]:
    return {"X-Session-Token": token}


# ── Token hashing ─────────────────────────────────────────────────────────────


def test_token_is_hashed_in_db(client, admin_token):
    """A DB-ben a session token hash-e tárolódik, nem a nyers token."""
    import asyncio

    from sqlalchemy import select

    from app.db.database import SessionLocal
    from app.db.models import UserSession
    from app.services.session import hash_token

    async def _fetch_tokens() -> list[str]:
        async with SessionLocal() as db:
            rows = await db.execute(select(UserSession.token))
            return [r[0] for r in rows.all()]

    tokens = asyncio.run(_fetch_tokens())
    # A nyers admin_token nem szerepelhet, csak a hash-e
    assert admin_token not in tokens
    assert hash_token(admin_token) in tokens
    # A tárolt érték 64 karakteres hex (SHA-256)
    assert all(len(t) == 64 for t in tokens)


def test_token_still_authorizes_after_hashing(client, admin_token):
    # A nyers token továbbra is működik (a lookup hash-eli)
    assert client.get("/api/auth/me", headers=_headers(admin_token)).status_code == 200


# ── Jobs ──────────────────────────────────────────────────────────────────────


def test_jobs_list_requires_admin(client, admin_token):
    res = client.get("/api/jobs", headers=_headers(admin_token))
    assert res.status_code == 200
    assert "jobs" in res.json()

    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "eve", "password": "eve12345", "role": "user"},
    )
    eve_token = client.post(
        "/api/auth/login", json={"username": "eve", "password": "eve12345"}
    ).json()["token"]
    assert client.get("/api/jobs", headers=_headers(eve_token)).status_code == 403


def test_retry_unknown_job_404(client, admin_token):
    res = client.post("/api/jobs/nem-letezik/retry", headers=_headers(admin_token))
    assert res.status_code == 404


# ── Webhookok ─────────────────────────────────────────────────────────────────


def test_webhook_disabled_without_secret(client):
    # WEBHOOK_SECRET nincs beállítva a tesztben → 404
    res = client.post("/api/webhooks/barmi/sonarr", json={"eventType": "Test"})
    assert res.status_code == 404


def test_webhook_with_secret(client, admin_token, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "webhook_secret", "titok123")

    # Rossz titok → 403
    assert client.post("/api/webhooks/rossz/sonarr", json={"eventType": "Test"}).status_code == 403

    # Teszt-esemény → nyugtázva
    res = client.post("/api/webhooks/titok123/sonarr", json={"eventType": "Test"})
    assert res.status_code == 200 and res.json()["test"] is True

    # Sonarr import esemény → értesítés naplózódik (botok kikapcsolva → csak napló)
    payload = {
        "eventType": "Download",
        "series": {"title": "Foundation"},
        "episodes": [{"seasonNumber": 2, "episodeNumber": 3, "title": "A Rock and a Hard Place"}],
    }
    res = client.post("/api/webhooks/titok123/sonarr", json=payload)
    assert res.status_code == 200 and res.json()["ok"] is True

    # Nem érdekes esemény (Grab) → ignorálva
    res = client.post("/api/webhooks/titok123/radarr", json={"eventType": "Grab"})
    assert res.status_code == 200 and res.json().get("ignored") is True

    # Az értesítés megjelenik a listában
    notifs = client.get("/api/notifications", headers=_headers(admin_token)).json()["notifications"]
    assert any("Foundation" in n["title"] for n in notifs)


def test_webhook_format_helpers():
    from app.main import _format_radarr_webhook, _format_sonarr_webhook

    s = _format_sonarr_webhook({
        "eventType": "Download",
        "series": {"title": "Severance"},
        "episodes": [{"seasonNumber": 1, "episodeNumber": 9, "title": "The We We Are"}],
    })
    assert s is not None and s[0] == "Letöltve: Severance" and "S01E09" in s[1]

    r = _format_radarr_webhook({"eventType": "Download", "movie": {"title": "Dune", "year": 2021}})
    assert r == ("Letöltve: Dune", "(2021)")

    assert _format_sonarr_webhook({"eventType": "Grab"}) is None
