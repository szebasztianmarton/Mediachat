from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), env_file_encoding="utf-8", extra="ignore")

    app_name: str = "media-chatbot"
    app_env: str = "development"
    app_secret: str = "change-me"
    app_url: str = "http://localhost:8000"

    # Első indításkor létrehozott admin fiók
    admin_username: str = "admin"
    admin_password: str = "media2024"
    session_ttl_days: int = 30

    database_url: str = "sqlite+aiosqlite:///./data/media_bot.db"

    redis_url: str = "redis://localhost:6379/0"
    redis_enabled: bool = True

    sonarr_url: str = "http://localhost:8989"
    sonarr_api_key: str = ""

    radarr_url: str = "http://localhost:7878"
    radarr_api_key: str = ""

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2:3b"

    tmdb_api_key: str = ""
    tmdb_language: str = "hu-HU"

    trakt_client_id: str = ""
    trakt_client_secret: str = ""
    trakt_access_token: str = ""

    max_series_quality: str = "1080p"

    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    cache_dir: str = "./data/cache"
    media_root: str = "./data/media"
    download_temp_dir: str = "./data/downloads"

    search_cache_ttl_seconds: int = 3600
    stale_media_days: int = 30
    storage_min_free_gb: float = 10.0
    storage_delete_files: bool = False

    queue_max_workers: int = 2

    telegram_bot_token: str = ""
    telegram_enabled: bool = False
    # Vesszővel elválasztott chat ID-k; üresen hagyva mindenki írhat a botnak.
    telegram_allowed_chat_ids: str = ""

    discord_bot_token: str = ""
    discord_enabled: bool = False
    # Vesszővel elválasztott guild (szerver) ID-k; üresen hagyva minden szerver engedélyezett.
    discord_allowed_guild_ids: str = ""

    # Letöltés-kész értesítés (Sonarr/Radarr webhook → bot)
    # A webhook URL: {APP_URL}/api/webhooks/{WEBHOOK_SECRET}/sonarr (ill. /radarr)
    webhook_secret: str = ""
    # Ahová a bot az értesítést küldi (üresen a Telegram allowlist első ID-jét használja)
    telegram_notify_chat_id: str = ""
    discord_notify_channel_id: str = ""

    # Torrent kliens (qbittorrent | transmission)
    torrent_client: str = "qbittorrent"
    torrent_url: str = ""
    torrent_username: str = ""
    torrent_password: str = ""
    # Befejezett letöltés automatikus törlése ennyi óra után (0 = kikapcsolva)
    torrent_auto_delete_hours: int = 0
    # Auto-törlésnél a letöltött fájlok is törlődjenek-e
    torrent_auto_delete_files: bool = True

    # Media szerverek ("Most nézi" widget)
    plex_url: str = ""
    plex_token: str = ""
    jellyfin_url: str = ""
    jellyfin_api_key: str = ""


settings = Settings()
