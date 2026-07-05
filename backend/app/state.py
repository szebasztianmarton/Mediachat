from dataclasses import dataclass

from app.services.cache import CacheService
from app.services.history import HistoryService
from app.services.media_sessions import MediaSessionsService
from app.services.notifications import NotificationService
from app.services.queue import QueueService
from app.services.recommendations import RecommendationService
from app.services.search import SearchService
from app.services.session import SessionService
from app.services.storage import StorageService
from app.services.torrents import TorrentService


@dataclass
class AppState:
    cache: CacheService
    search: SearchService
    queue: QueueService
    recommendations: RecommendationService
    storage: StorageService
    session: SessionService
    torrents: TorrentService
    media: MediaSessionsService
    history: HistoryService
    notifications: NotificationService


app_state: AppState | None = None
