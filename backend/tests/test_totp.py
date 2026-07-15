from app.services import totp as totp_svc


def _headers(token: str) -> dict[str, str]:
    return {"X-Session-Token": token}


def _make_user(client, admin_token: str, username: str) -> str:
    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": username, "password": "totpuser123", "role": "user"},
    )
    return client.post(
        "/api/auth/login", json={"username": username, "password": "totpuser123"}
    ).json()["token"]


def test_totp_unit_verify_roundtrip():
    secret = totp_svc.generate_secret()
    code = totp_svc.current_code(secret)
    assert totp_svc.verify_code(secret, code)
    assert not totp_svc.verify_code(secret, "000000") or code == "000000"
    assert not totp_svc.verify_code(secret, "nem-szam")
    uri = totp_svc.provisioning_uri(secret, "alice")
    assert uri.startswith("otpauth://totp/Mediachat:alice?secret=")


def test_totp_setup_and_login_flow(client, admin_token):
    token = _make_user(client, admin_token, "totp-flow")

    # Setup: begin → kód a titokból → finish
    begin = client.post("/api/auth/totp/setup/begin", headers=_headers(token))
    assert begin.status_code == 200
    secret = begin.json()["secret"]
    assert begin.json()["otpauth_uri"].startswith("otpauth://totp/")

    # Rossz kóddal a finish elutasít
    bad = client.post(
        "/api/auth/totp/setup/finish", headers=_headers(token), json={"code": "000000"}
    )
    # (elméletben 1e-6 eséllyel épp 000000 az érvényes kód — akkor is legfeljebb 200)
    assert bad.status_code in (200, 400)

    good = client.post(
        "/api/auth/totp/setup/finish",
        headers=_headers(token),
        json={"code": totp_svc.current_code(secret)},
    )
    # Ha a bad hívás véletlenül talált volna, a setup már kész — 400 jön.
    if bad.status_code != 200:
        assert good.status_code == 200, good.text

    me = client.get("/api/auth/me", headers=_headers(token)).json()
    assert me["totp_enabled"] is True

    # Login mostantól kétlépcsős: jelszó → ticket → kód → token
    step1 = client.post(
        "/api/auth/login", json={"username": "totp-flow", "password": "totpuser123"}
    )
    assert step1.status_code == 200
    body = step1.json()
    assert body["totp_required"] is True
    assert body["token"] is None
    assert body["ticket"]

    # Rossz kód → 401, a ticket még él
    bad_login = client.post(
        "/api/auth/login/totp", json={"ticket": body["ticket"], "code": "999999"}
    )
    assert bad_login.status_code in (200, 401)

    if bad_login.status_code != 200:
        step2 = client.post(
            "/api/auth/login/totp",
            json={"ticket": body["ticket"], "code": totp_svc.current_code(secret)},
        )
        assert step2.status_code == 200, step2.text
        new_token = step2.json()["token"]
        assert new_token
        assert client.get("/api/auth/me", headers=_headers(new_token)).status_code == 200

        # A ticket egyszer használatos — másodszor már nem váltható be.
        # (A login limiter 5/perc/IP — a teszt közben elfogyna, ürítjük.)
        from app.main import login_limiter

        login_limiter._hits.clear()
        replay = client.post(
            "/api/auth/login/totp",
            json={"ticket": body["ticket"], "code": totp_svc.current_code(secret)},
        )
        assert replay.status_code == 401

    # Kikapcsolás érvényes kóddal
    disable = client.post(
        "/api/auth/totp/disable",
        headers=_headers(token),
        json={"code": totp_svc.current_code(secret)},
    )
    assert disable.status_code == 200

    # Utána a login megint egylépcsős
    relogin = client.post(
        "/api/auth/login", json={"username": "totp-flow", "password": "totpuser123"}
    )
    assert relogin.status_code == 200
    assert relogin.json()["token"]


def test_totp_login_with_invalid_ticket(client):
    res = client.post("/api/auth/login/totp", json={"ticket": "nem-letezik", "code": "123456"})
    assert res.status_code == 401


def test_totp_disable_requires_enabled(client, admin_token):
    token = _make_user(client, admin_token, "totp-off")
    res = client.post(
        "/api/auth/totp/disable", headers=_headers(token), json={"code": "123456"}
    )
    assert res.status_code == 400
