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


def test_backup_restore_roundtrip(client, admin_token):
    # Pillanatkép a JELENLEGI állapotról (admin + a korábbi tesztek user-ei).
    snapshot = client.post("/api/backups/create", headers=_headers(admin_token), json={}).json()
    filename = snapshot["file"]

    # Hozzunk létre egy "jelölő" felhasználót, ami a visszaállítás UTÁN már
    # nem szabad, hogy létezzen.
    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "restore-marker", "password": "marker1234", "role": "user"},
    )
    marker_login = client.post(
        "/api/auth/login", json={"username": "restore-marker", "password": "marker1234"}
    )
    assert marker_login.status_code == 200

    res = client.post(f"/api/backups/{filename}/restore", headers=_headers(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert body["logout_required"] is True
    assert body["restored"]["file"] == filename

    # A visszaállítás minden session-t (a most használt admin_token-t is)
    # érvénytelenít — az admin csak új bejelentkezéssel jut vissza.
    assert client.get("/api/backups", headers=_headers(admin_token)).status_code == 401

    fresh_admin = client.post(
        "/api/auth/login", json={"username": "admin", "password": "testpass123"}
    )
    assert fresh_admin.status_code == 200
    fresh_token = fresh_admin.json()["token"]

    # A jelölő felhasználó a snapshot-ban még nem létezett — a restore után sem létezhet.
    marker_after = client.post(
        "/api/auth/login", json={"username": "restore-marker", "password": "marker1234"}
    )
    assert marker_after.status_code == 401

    users = client.get("/api/users", headers=_headers(fresh_token)).json()
    usernames = {u["username"] for u in users["users"]}
    assert "restore-marker" not in usernames
    assert "admin" in usernames


def test_backup_restore_requires_admin(client, admin_token):
    snapshot = client.post("/api/backups/create", headers=_headers(admin_token), json={}).json()
    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "restoreuser", "password": "restoreuser1", "role": "user"},
    )
    utoken = client.post(
        "/api/auth/login", json={"username": "restoreuser", "password": "restoreuser1"}
    ).json()["token"]
    res = client.post(f"/api/backups/{snapshot['file']}/restore", headers=_headers(utoken))
    assert res.status_code == 403


def test_backup_restore_unknown_file_404(client, admin_token):
    res = client.post("/api/backups/does-not-exist.json/restore", headers=_headers(admin_token))
    assert res.status_code == 404


def test_backup_restore_preview_shows_diff(client, admin_token):
    snapshot = client.post("/api/backups/create", headers=_headers(admin_token), json={}).json()
    filename = snapshot["file"]

    # Egy user hozzáadva a snapshot UTÁN — a preview-nak látnia kell a diffet
    # a mentésben tárolt és a jelenlegi állapot között, restore lefuttatása nélkül.
    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "preview-marker", "password": "marker1234", "role": "user"},
    )

    res = client.get(f"/api/backups/{filename}/restore/preview", headers=_headers(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert body["file"] == filename
    assert body["current"]["users"] == body["backup"]["users"] + 1

    # A preview nem destruktív — a jelölő usernek utána is léteznie kell.
    login = client.post(
        "/api/auth/login", json={"username": "preview-marker", "password": "marker1234"}
    )
    assert login.status_code == 200


def test_backup_restore_preview_requires_admin(client, admin_token):
    snapshot = client.post("/api/backups/create", headers=_headers(admin_token), json={}).json()
    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "previewuser", "password": "previewuser1", "role": "user"},
    )
    utoken = client.post(
        "/api/auth/login", json={"username": "previewuser", "password": "previewuser1"}
    ).json()["token"]
    res = client.get(f"/api/backups/{snapshot['file']}/restore/preview", headers=_headers(utoken))
    assert res.status_code == 403


def test_backup_restore_preview_unknown_file_404(client, admin_token):
    res = client.get("/api/backups/does-not-exist.json/restore/preview", headers=_headers(admin_token))
    assert res.status_code == 404


def test_ollama_models_empty_when_unconfigured(client, admin_token):
    # A teszt-env-ben OLLAMA_BASE_URL üres — a végpont ne dőljön el, csak
    # üres listát adjon vissza.
    res = client.get("/api/ollama/models", headers=_headers(admin_token))
    assert res.status_code == 200
    assert res.json() == {"models": []}


def test_ollama_models_requires_admin(client, admin_token):
    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "modeluser", "password": "modeluser1", "role": "user"},
    )
    utoken = client.post(
        "/api/auth/login", json={"username": "modeluser", "password": "modeluser1"}
    ).json()["token"]
    assert client.get("/api/ollama/models", headers=_headers(utoken)).status_code == 403
