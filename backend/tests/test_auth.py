def _headers(token: str) -> dict[str, str]:
    return {"X-Session-Token": token}


def test_login_wrong_password(client):
    res = client.post("/api/auth/login", json={"username": "admin", "password": "rossz"})
    assert res.status_code == 401


def test_login_unknown_user(client):
    res = client.post("/api/auth/login", json={"username": "nincs-ilyen", "password": "x"})
    assert res.status_code == 401


def test_login_success_returns_token_and_role(client):
    res = client.post("/api/auth/login", json={"username": "admin", "password": "testpass123"})
    assert res.status_code == 200
    body = res.json()
    assert body["token"]
    assert body["user"]["role"] == "admin"
    assert body["user"]["username"] == "admin"


def test_protected_endpoint_requires_token(client):
    assert client.get("/api/training/files").status_code == 401


def test_protected_endpoint_with_token(client, admin_token):
    assert client.get("/api/training/files", headers=_headers(admin_token)).status_code == 200


def test_me_returns_current_user(client, admin_token):
    res = client.get("/api/auth/me", headers=_headers(admin_token))
    assert res.status_code == 200
    assert res.json()["username"] == "admin"


def test_user_crud_and_role_enforcement(client, admin_token):
    # Létrehozás
    res = client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "alice", "password": "alice1234", "role": "user"},
    )
    assert res.status_code == 200, res.text
    alice_id = res.json()["id"]

    # Duplikált felhasználónév → 400
    res = client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "alice", "password": "masik123", "role": "user"},
    )
    assert res.status_code == 400

    # Alice bejelentkezik — user szerepkörrel admin végpont 403
    res = client.post("/api/auth/login", json={"username": "alice", "password": "alice1234"})
    assert res.status_code == 200
    alice_token = res.json()["token"]
    assert client.get("/api/users", headers=_headers(alice_token)).status_code == 403
    assert client.get("/api/storage/status", headers=_headers(alice_token)).status_code == 403

    # Session-szintű végpont user-rel elérhető
    assert client.get("/api/torrents", headers=_headers(alice_token)).status_code == 200

    # Jelszócsere érvényteleníti Alice sessionjét
    res = client.put(
        f"/api/users/{alice_id}/password",
        headers=_headers(admin_token),
        json={"password": "ujjelszo123"},
    )
    assert res.status_code == 200
    assert client.get("/api/auth/me", headers=_headers(alice_token)).status_code == 401

    # Törlés
    assert client.delete(f"/api/users/{alice_id}", headers=_headers(admin_token)).status_code == 200
    res = client.post("/api/auth/login", json={"username": "alice", "password": "ujjelszo123"})
    assert res.status_code == 401


def test_admin_cannot_delete_self(client, admin_token):
    me = client.get("/api/auth/me", headers=_headers(admin_token)).json()
    res = client.delete(f"/api/users/{me['id']}", headers=_headers(admin_token))
    assert res.status_code == 400


def test_logout_revokes_token(client):
    res = client.post("/api/auth/login", json={"username": "admin", "password": "testpass123"})
    token = res.json()["token"]
    assert client.post("/api/auth/logout", headers=_headers(token)).status_code == 200
    assert client.get("/api/auth/me", headers=_headers(token)).status_code == 401


def test_login_rate_limited_after_5_attempts(client):
    for _ in range(5):
        client.post("/api/auth/login", json={"username": "admin", "password": "rossz"})
    res = client.post("/api/auth/login", json={"username": "admin", "password": "rossz"})
    assert res.status_code == 429
    assert "Retry-After" in res.headers
