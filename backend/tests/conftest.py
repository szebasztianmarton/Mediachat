"""Teszt-környezet: a konfigurációt env-változókkal írjuk felül, MIELŐTT
bármelyik app modul importálódna (a settings import-időben olvassa be őket)."""

import os
import tempfile

_TMP_DIR = tempfile.mkdtemp(prefix="mediachat-test-")

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TMP_DIR}/test.db"
os.environ["REDIS_ENABLED"] = "false"
os.environ["TELEGRAM_ENABLED"] = "false"
os.environ["DISCORD_ENABLED"] = "false"
os.environ["ADMIN_USERNAME"] = "admin"
os.environ["ADMIN_PASSWORD"] = "testpass123"
os.environ["SONARR_URL"] = ""
os.environ["SONARR_API_KEY"] = ""
os.environ["RADARR_URL"] = ""
os.environ["RADARR_API_KEY"] = ""
os.environ["TMDB_API_KEY"] = ""
os.environ["OLLAMA_BASE_URL"] = ""
os.environ["QBITTORRENT_URL"] = ""
os.environ["PLEX_URL"] = ""
os.environ["JELLYFIN_URL"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def reset_rate_limiters():
    """A login limiter (5/perc) ne akassza meg a többi tesztet."""
    from app.main import chat_limiter, login_limiter

    login_limiter._hits.clear()
    chat_limiter._hits.clear()
    yield


@pytest.fixture()
def admin_token(client) -> str:
    res = client.post("/api/auth/login", json={"username": "admin", "password": "testpass123"})
    assert res.status_code == 200, res.text
    return res.json()["token"]
