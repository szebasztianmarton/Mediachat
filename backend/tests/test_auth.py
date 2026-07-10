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


def test_list_sessions_shows_current_and_others(client, admin_token):
    res = client.post("/api/auth/login", json={"username": "admin", "password": "testpass123"})
    second_token = res.json()["token"]

    res = client.get("/api/auth/sessions", headers=_headers(admin_token))
    assert res.status_code == 200
    sessions = res.json()["sessions"]
    assert len(sessions) >= 2
    current = [s for s in sessions if s["is_current"]]
    assert len(current) == 1

    # A második munkamenetből nézve az elsőt (admin_token) NEM a jelenlegi.
    res2 = client.get("/api/auth/sessions", headers=_headers(second_token))
    other_current = [s for s in res2.json()["sessions"] if s["is_current"]]
    assert len(other_current) == 1
    assert other_current[0]["id"] != current[0]["id"]


def test_revoke_own_session(client, admin_token):
    res = client.post("/api/auth/login", json={"username": "admin", "password": "testpass123"})
    second_token = res.json()["token"]

    # A session-szintű fixture-ök miatt korábbi tesztekből is maradhattak
    # aktív admin-session-ök — mindet kirúgjuk, hogy a second_token biztosan
    # köztük legyen, majd ellenőrizzük, hogy a SAJÁT (admin_token) session túléli.
    sessions = client.get("/api/auth/sessions", headers=_headers(admin_token)).json()["sessions"]
    others = [s for s in sessions if not s["is_current"]]
    assert others

    for s in others:
        assert client.delete(f"/api/auth/sessions/{s['id']}", headers=_headers(admin_token)).status_code == 200

    # A kirúgott munkamenet tokenje innentől érvénytelen.
    assert client.get("/api/auth/me", headers=_headers(second_token)).status_code == 401
    # A sajátunk viszont még mindig érvényes.
    assert client.get("/api/auth/me", headers=_headers(admin_token)).status_code == 200


def test_revoke_session_requires_ownership(client, admin_token):
    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "sess-owner", "password": "sessowner1", "role": "user"},
    )
    other_token = client.post(
        "/api/auth/login", json={"username": "sess-owner", "password": "sessowner1"}
    ).json()["token"]
    other_session_id = client.get("/api/auth/sessions", headers=_headers(other_token)).json()["sessions"][0]["id"]

    # Az admin nem rúghatja ki a másik user session-jét ezen a végponton
    # (mindenki csak a sajátját törölheti) — 404, nem 200.
    res = client.delete(f"/api/auth/sessions/{other_session_id}", headers=_headers(admin_token))
    assert res.status_code == 404
    assert client.get("/api/auth/me", headers=_headers(other_token)).status_code == 200


def test_revoke_unknown_session_404(client, admin_token):
    res = client.delete("/api/auth/sessions/does-not-exist", headers=_headers(admin_token))
    assert res.status_code == 404


def test_login_rate_limited_after_5_attempts(client):
    for _ in range(5):
        client.post("/api/auth/login", json={"username": "admin", "password": "rossz"})
    res = client.post("/api/auth/login", json={"username": "admin", "password": "rossz"})
    assert res.status_code == 429
    assert "Retry-After" in res.headers
