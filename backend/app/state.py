from dataclasses import dataclass

from app.services.cache import CacheService
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


app_state: AppState | None = None
