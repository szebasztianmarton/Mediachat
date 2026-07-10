"""Passkey (WebAuthn) végpontok — a teljes kriptográfiai ceremóniát (valódi
authenticator szimulációját) nem teszteljük itt, csak a felszínt: jogosultság,
válasz-alak és hibakezelés (rossz/lejárt adatra ne 500-zal dőljön el)."""


def _headers(token: str) -> dict[str, str]:
    return {"X-Session-Token": token}


def test_register_begin_requires_auth(client):
    assert client.post("/api/auth/webauthn/register/begin").status_code == 401


def test_register_begin_returns_valid_options(client, admin_token):
    res = client.post("/api/auth/webauthn/register/begin", headers=_headers(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert body["rp"]["id"] == "localhost"
    assert body["challenge"]
    assert body["user"]["name"] == "admin"


def test_register_finish_rejects_invalid_credential(client, admin_token):
    client.post("/api/auth/webauthn/register/begin", headers=_headers(admin_token))
    res = client.post(
        "/api/auth/webauthn/register/finish",
        headers=_headers(admin_token),
        json={"credential": {"id": "nem-letezik", "rawId": "x", "response": {}, "type": "public-key"}},
    )
    assert res.status_code == 400


def test_register_finish_without_begin_rejected(client, admin_token):
    # Nincs előzőleg tárolt challenge ehhez a userhez (vagy lejárt).
    res = client.post(
        "/api/auth/webauthn/register/finish",
        headers=_headers(admin_token),
        json={"credential": {}},
    )
    assert res.status_code in (400, 422)


def test_credentials_list_empty_initially(client, admin_token):
    res = client.get("/api/auth/webauthn/credentials", headers=_headers(admin_token))
    assert res.status_code == 200
    assert res.json() == {"credentials": []}


def test_credentials_list_requires_auth(client):
    assert client.get("/api/auth/webauthn/credentials").status_code == 401


def test_delete_nonexistent_credential_is_noop(client, admin_token):
    res = client.delete("/api/auth/webauthn/credentials/does-not-exist", headers=_headers(admin_token))
    assert res.status_code == 200
    assert res.json() == {"success": True}


def test_login_begin_is_public_and_returns_ceremony(client):
    res = client.post("/api/auth/webauthn/login/begin")
    assert res.status_code == 200
    body = res.json()
    assert body["ceremony_id"]
    assert body["options"]["challenge"]
    assert body["options"]["rpId"] == "localhost"


def test_login_finish_rejects_unknown_ceremony(client):
    res = client.post(
        "/api/auth/webauthn/login/finish",
        json={"ceremony_id": "nincs-ilyen", "credential": {"id": "x"}},
    )
    assert res.status_code == 401


def test_login_finish_rejects_unknown_credential(client):
    begin = client.post("/api/auth/webauthn/login/begin").json()
    res = client.post(
        "/api/auth/webauthn/login/finish",
        json={"ceremony_id": begin["ceremony_id"], "credential": {"id": "ismeretlen-credential"}},
    )
    assert res.status_code == 401
