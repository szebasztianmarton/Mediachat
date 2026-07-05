def _headers(token: str) -> dict[str, str]:
    return {"X-Session-Token": token}


def test_library_stats_shape(client, admin_token):
    res = client.get("/api/library/stats", headers=_headers(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert "movies" in body and "series" in body and "combined" in body
    assert "count" in body["movies"] and "size_bytes" in body["movies"]
    assert "seasons" in body["series"] and "top_genres" in body["series"]


def test_library_storage_shape(client, admin_token):
    res = client.get("/api/library/storage", headers=_headers(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert body["top_movies"] == [] and body["top_series"] == []
    assert "disks" in body


def test_library_endpoints_require_admin(client, admin_token):
    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "libuser", "password": "libuser12", "role": "user"},
    )
    utoken = client.post(
        "/api/auth/login", json={"username": "libuser", "password": "libuser12"}
    ).json()["token"]
    assert client.get("/api/library/stats", headers=_headers(utoken)).status_code == 403
    assert client.get("/api/library/storage", headers=_headers(utoken)).status_code == 403


def test_calendar_endpoint(client, admin_token):
    res = client.get(
        "/api/calendar?start=2026-07-01&end=2026-07-31", headers=_headers(admin_token)
    )
    assert res.status_code == 200
    assert "events" in res.json()


def test_backup_create_and_list(client, admin_token):
    res = client.post("/api/backups/create", headers=_headers(admin_token), json={})
    assert res.status_code == 200
    body = res.json()
    assert body["users"] >= 1
    assert body["file"].startswith("backup-")

    res = client.get("/api/backups", headers=_headers(admin_token))
    assert res.status_code == 200
    backups = res.json()["backups"]
    assert any(b["file"] == body["file"] for b in backups)


def test_backup_requires_admin(client, admin_token):
    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "bkuser", "password": "bkuser123", "role": "user"},
    )
    utoken = client.post(
        "/api/auth/login", json={"username": "bkuser", "password": "bkuser123"}
    ).json()["token"]
    assert client.post("/api/backups/create", headers=_headers(utoken), json={}).status_code == 403
