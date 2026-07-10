def _headers(token: str) -> dict[str, str]:
    return {"X-Session-Token": token}


def _seed_added_event(user_id: str) -> None:
    """Egy 'added' MediaEvent közvetlen DB-be írása — a valódi /api/add sync
    útja Sonarr/Radarr nélkül mindig 400-at adna, ezért a kvóta-teszthez
    közvetlenül szimuláljuk a már meglévő hozzáadást."""
    import asyncio

    async def _write() -> None:
        from app.db.database import SessionLocal
        from app.db.models import MediaEvent

        async with SessionLocal() as db:
            db.add(
                MediaEvent(
                    user_id=user_id,
                    media_type="movie",
                    external_id=1,
                    tmdb_id=None,
                    title="Kvóta teszt film",
                    event_type="added",
                )
            )
            await db.commit()

    asyncio.run(_write())


def _set_quota(client, admin_token: str, quota: str) -> None:
    res = client.put(
        "/api/config",
        headers=_headers(admin_token),
        json={"values": {"user_daily_add_quota": quota}},
    )
    assert res.status_code == 200


def test_quota_blocks_user_after_limit_reached(client, admin_token):
    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "quotauser", "password": "quotauser1", "role": "user"},
    )
    token = client.post(
        "/api/auth/login", json={"username": "quotauser", "password": "quotauser1"}
    ).json()["token"]
    user_id = client.get("/api/auth/me", headers=_headers(token)).json()["id"]

    _set_quota(client, admin_token, "1")
    try:
        _seed_added_event(user_id)

        res = client.post(
            "/api/add",
            headers=_headers(token),
            json={"media_type": "movie", "external_id": 1, "title": "Bármi", "async_job": True},
        )
        assert res.status_code == 429
    finally:
        _set_quota(client, admin_token, "0")


def test_quota_does_not_apply_to_admin(client, admin_token):
    admin_id = client.get("/api/auth/me", headers=_headers(admin_token)).json()["id"]

    _set_quota(client, admin_token, "1")
    try:
        _seed_added_event(admin_id)

        res = client.post(
            "/api/add",
            headers=_headers(admin_token),
            json={"media_type": "movie", "external_id": 1, "title": "Bármi", "async_job": True},
        )
        # Admin mindig kivétel a kvóta alól, a kérés sorba kerül (200), nem 429.
        assert res.status_code == 200
    finally:
        _set_quota(client, admin_token, "0")


def test_quota_zero_means_unlimited(client, admin_token):
    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "quotauser2", "password": "quotauser1", "role": "user"},
    )
    token = client.post(
        "/api/auth/login", json={"username": "quotauser2", "password": "quotauser1"}
    ).json()["token"]
    user_id = client.get("/api/auth/me", headers=_headers(token)).json()["id"]

    # user_daily_add_quota alapértelmezetten 0 (korlátlan) — több 'added' esemény
    # ellenére sem tiltja le a kérést.
    _seed_added_event(user_id)
    _seed_added_event(user_id)

    res = client.post(
        "/api/add",
        headers=_headers(token),
        json={"media_type": "movie", "external_id": 1, "title": "Bármi", "async_job": True},
    )
    assert res.status_code == 200
