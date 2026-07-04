from dataclasses import dataclass

from app.services.cache import CacheService
from app.services.history import HistoryService
from app.services.media_sessions import MediaSessionsService
from app.services.qbittorrent import QbittorrentClient
from app.services.queue import QueueService
from app.services.recommendations import RecommendationService
from app.services.search import SearchService
from app.services.session import SessionService
from app.services.storage import StorageService


@dataclass
class AppState:
    cache: CacheService
    search: SearchService
    queue: QueueService
    recommendations: RecommendationService
    storage: StorageService
    session: SessionService
    torrents: QbittorrentClient
    media: MediaSessionsService
    history: HistoryService


app_state: AppState | None = None
