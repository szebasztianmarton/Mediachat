import time
from collections import deque


class RateLimiter:
    """Egyszerű, memóriabeli csúszóablakos rate limiter.

    Homelab méretre elég — nincs külső függőség, folyamatonként él.
    Több workeres (multi-process) futtatásnál worker-enként külön számol.
    """

    def __init__(self, max_requests: int, window_seconds: float) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] > self.window_seconds:
            hits.popleft()
        if len(hits) >= self.max_requests:
            return False
        hits.append(now)
        self._maybe_prune()
        return True

    def retry_after_seconds(self, key: str) -> int:
        hits = self._hits.get(key)
        if not hits:
            return 0
        elapsed = time.monotonic() - hits[0]
        return max(1, int(self.window_seconds - elapsed) + 1)

    def _maybe_prune(self) -> None:
        # Ne nőjön korlátlanul a kulcstér — az üres ablakú kulcsokat eldobjuk.
        if len(self._hits) < 1024:
            return
        now = time.monotonic()
        for key in list(self._hits.keys()):
            hits = self._hits[key]
            while hits and now - hits[0] > self.window_seconds:
                hits.popleft()
            if not hits:
                del self._hits[key]
