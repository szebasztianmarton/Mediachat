import json
import logging
import time
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)


class CacheService:
    def __init__(self) -> None:
        self._memory: dict[str, tuple[str, float]] = {}  # key → (payload, expires_at)
        self._redis = None
        self._enabled = settings.redis_enabled

    @property
    def connected(self) -> bool:
        return self._redis is not None

    async def connect(self) -> None:
        if not self._enabled:
            return
        try:
            import redis.asyncio as redis

            self._redis = redis.from_url(settings.redis_url, decode_responses=True)
            await self._redis.ping()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Redis nem érhető el, memória cache-t használunk: %s", exc)
            self._redis = None

    async def close(self) -> None:
        if self._redis is not None:
            try:
                await self._redis.aclose()
            except Exception:  # noqa: BLE001
                pass

    def _drop_redis(self, exc: Exception) -> None:
        # Ha a Redis menet közben esik ki, degradálódunk memória cache-re
        # ahelyett, hogy minden keresés 500-zal elszállna.
        logger.warning("Redis hiba, átállás memória cache-re: %s", exc)
        self._redis = None

    async def get_json(self, key: str) -> Any | None:
        if self._redis is not None:
            try:
                raw = await self._redis.get(key)
            except Exception as exc:  # noqa: BLE001
                self._drop_redis(exc)
            else:
                return json.loads(raw) if raw else None
        item = self._memory.get(key)
        if item is None:
            return None
        payload, expires_at = item
        if time.monotonic() > expires_at:
            del self._memory[key]
            return None
        return json.loads(payload)

    async def set_json(self, key: str, value: Any, ttl: int | None = None) -> None:
        payload = json.dumps(value, ensure_ascii=False)
        ttl = ttl or settings.search_cache_ttl_seconds
        if self._redis is not None:
            try:
                await self._redis.set(key, payload, ex=ttl)
                return
            except Exception as exc:  # noqa: BLE001
                self._drop_redis(exc)
        self._memory[key] = (payload, time.monotonic() + ttl)

    async def delete_prefix(self, prefix: str) -> int:
        deleted = 0
        if self._redis is not None:
            try:
                keys = [key async for key in self._redis.scan_iter(match=f"{prefix}*")]
                if keys:
                    deleted = await self._redis.delete(*keys)
                return deleted
            except Exception as exc:  # noqa: BLE001
                self._drop_redis(exc)
        for key in list(self._memory.keys()):
            if key.startswith(prefix):
                del self._memory[key]
                deleted += 1
        return deleted
