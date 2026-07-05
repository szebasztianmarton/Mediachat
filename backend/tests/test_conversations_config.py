def _headers(token: str) -> dict[str, str]:
    return {"X-Session-Token": token}


def test_conversations_empty_initially(client, admin_token):
    res = client.get("/api/conversations", headers=_headers(admin_token))
    assert res.status_code == 200
    assert isinstance(res.json()["conversations"], list)


def test_stored_message_parses_results_payload():
    """A payload-ban tárolt találatok visszaalakulnak SearchResult-tá
    (regresszió: hiányzó SearchResult import a main-ben)."""
    import json as jsonlib
    from types import SimpleNamespace

    from app.main import _stored_message

    msg = SimpleNamespace(
        role="assistant",
        content="1 találat.",
        action="search",
        payload=jsonlib.dumps({
            "results": [{
                "result_id": "movie-1",
                "title": "Teszt Film",
                "media_type": "movie",
                "external_id": 1,
            }],
            "added": {"title": "Teszt Film", "media_type": "movie"},
        }),
        created_at=None,
    )
    stored = _stored_message(msg)
    assert stored.results is not None and stored.results[0].title == "Teszt Film"
    assert stored.added is not None and stored.added.media_type == "movie"


def test_stream_creates_and_persists_conversation(client, admin_token):
    # Search intent (nincs Sonarr/Radarr konfigurálva a tesztben → "nem sikerült
    # keresni" chat-válasz), de a beszélgetésnek létre kell jönnie és perzisztálnia.
    with client.stream(
        "POST",
        "/api/chat/agent/stream",
        headers=_headers(admin_token),
        json={"message": "Inception film"},
    ) as res:
        assert res.status_code == 200
        body = "".join(chunk for chunk in res.iter_text())
    assert '"type": "meta"' in body
    assert '"type": "done"' in body

    import json as jsonlib

    conv_id = None
    for line in body.split("\n\n"):
        line = line.strip()
        if line.startswith("data:"):
            event = jsonlib.loads(line[5:])
            if event["type"] == "meta":
                conv_id = event["conversation_id"]
                break
    assert conv_id

    # A lista tartalmazza, a részletekben ott a user üzenet + a válasz
    res = client.get("/api/conversations", headers=_headers(admin_token))
    assert any(c["id"] == conv_id for c in res.json()["conversations"])

    res = client.get(f"/api/conversations/{conv_id}", headers=_headers(admin_token))
    assert res.status_code == 200
    detail = res.json()
    assert detail["title"].startswith("Inception")
    roles = [m["role"] for m in detail["messages"]]
    assert roles[0] == "user"
    assert len(roles) >= 2  # user + assistant/error

    # Törlés
    assert client.delete(f"/api/conversations/{conv_id}", headers=_headers(admin_token)).status_code == 200
    assert client.get(f"/api/conversations/{conv_id}", headers=_headers(admin_token)).status_code == 404


def test_conversation_ownership(client, admin_token):
    # Másik user nem látja az admin beszélgetését
    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "bob", "password": "bob12345", "role": "user"},
    )
    bob_token = client.post(
        "/api/auth/login", json={"username": "bob", "password": "bob12345"}
    ).json()["token"]

    with client.stream(
        "POST",
        "/api/chat/agent/stream",
        headers=_headers(admin_token),
        json={"message": "Titkos admin kereses"},
    ) as res:
        body = "".join(res.iter_text())
    import json as jsonlib

    conv_id = next(
        jsonlib.loads(line[5:])["conversation_id"]
        for line in body.split("\n\n")
        if line.strip().startswith("data:") and '"meta"' in line
    )
    assert client.get(f"/api/conversations/{conv_id}", headers=_headers(bob_token)).status_code == 404


def test_config_get_and_update(client, admin_token):
    res = client.get("/api/config", headers=_headers(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert "sonarr_url" in body["values"]
    assert "sonarr_api_key" in body["secrets"]

    # Frissítés: nem-titkos + titkos mező
    res = client.put(
        "/api/config",
        headers=_headers(admin_token),
        json={"values": {"sonarr_url": "http://sonarr.test:8989", "sonarr_api_key": "abcd1234efgh"}},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["values"]["sonarr_url"] == "http://sonarr.test:8989"
    assert body["secrets"]["sonarr_api_key"] == "****efgh"  # maszkolva, sosem teljes érték

    # Ismeretlen kulcs → 400
    res = client.put(
        "/api/config",
        headers=_headers(admin_token),
        json={"values": {"nem_letezo_kulcs": "x"}},
    )
    assert res.status_code == 400


def test_config_test_endpoint(client, admin_token):
    # Nem tesztelhető szolgáltatás → 404
    res = client.post("/api/config/test/trakt", headers=_headers(admin_token))
    assert res.status_code == 404

    # Nem konfigurált sonarr → ok:false, értelmes üzenettel (nem 500)
    res = client.post("/api/config/test/sonarr", headers=_headers(admin_token))
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False
    assert body["message"]

    # Nem konfigurált torrent → ok:false
    res = client.post("/api/config/test/torrent", headers=_headers(admin_token))
    assert res.status_code == 200
    assert res.json()["ok"] is False


def test_config_torrent_client_editable(client, admin_token):
    res = client.put(
        "/api/config",
        headers=_headers(admin_token),
        json={"values": {"torrent_client": "transmission", "torrent_url": "http://tr.test:9090"}},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["values"]["torrent_client"] == "transmission"
    assert body["values"]["torrent_url"] == "http://tr.test:9090"
    # Visszaállítás, hogy a többi tesztet ne érintse
    client.put(
        "/api/config",
        headers=_headers(admin_token),
        json={"values": {"torrent_client": "qbittorrent", "torrent_url": ""}},
    )


def test_config_requires_admin(client, admin_token):
    client.post(
        "/api/users",
        headers=_headers(admin_token),
        json={"username": "carol", "password": "carol123", "role": "user"},
    )
    carol_token = client.post(
        "/api/auth/login", json={"username": "carol", "password": "carol123"}
    ).json()["token"]
    assert client.get("/api/config", headers=_headers(carol_token)).status_code == 403
