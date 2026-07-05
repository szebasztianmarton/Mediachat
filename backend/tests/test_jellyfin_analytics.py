def _headers(token: str) -> dict[str, str]:
    return {"X-Session-Token": token}


def test_jellyfin_analytics_unconfigured(client, admin_token):
    res = client.get("/api/jellyfin/analytics", headers=_headers(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert body["configured"] is False
    assert body["users"] == []


def test_provisioning_targets(client, admin_token):
    res = client.get("/api/provisioning/targets", headers=_headers(admin_token))
    assert res.status_code == 200
    body = res.json()
    # A tesztben nincs Jellyfin/Plex konfigurálva
    assert body["jellyfin"] is False
    assert body["plex"] is False


def test_provisioning_targets_requires_admin(client, admin_token):
    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "provuser", "password": "prov1234", "role": "user"},
    )
    utoken = client.post(
        "/api/auth/login", json={"username": "provuser", "password": "prov1234"}
    ).json()["token"]
    assert client.get("/api/provisioning/targets", headers=_headers(utoken)).status_code == 403
    assert client.get("/api/jellyfin/analytics", headers=_headers(utoken)).status_code == 403


def test_create_user_provision_jellyfin_ignored_when_unconfigured(client, admin_token):
    # provision_jellyfin=True, de Jellyfin nincs konfigurálva → a helyi user létrejön,
    # a Jellyfin lépés csendben kimarad (nem hiba)
    res = client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "jfuser", "password": "jfuser123", "role": "user", "provision_jellyfin": True},
    )
    assert res.status_code == 200
    assert res.json()["username"] == "jfuser"


def test_total_storage_aggregation_keys(client, admin_token):
    res = client.get("/api/library/storage", headers=_headers(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert "total_bytes" in body and "used_bytes" in body and "free_bytes" in body
