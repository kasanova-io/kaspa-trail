# ABOUTME: Simple in-memory TTL cache for API responses.
# ABOUTME: Prevents redundant external API calls during graph exploration.

import time
from typing import Any


class TTLCache:
    """Thread-safe TTL cache with max size eviction."""

    def __init__(self, default_ttl: float = 60.0, max_size: int = 1000):
        self._store: dict[str, tuple[float, Any]] = {}
        self._default_ttl = default_ttl
        self._max_size = max_size

    def get(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if time.monotonic() > expires_at:
            del self._store[key]
            return None
        return value

    def set(self, key: str, value: Any, ttl: float | None = None) -> None:
        if len(self._store) >= self._max_size:
            self._evict()
        self._store[key] = (time.monotonic() + (ttl or self._default_ttl), value)

    def _evict(self) -> None:
        now = time.monotonic()
        expired = [k for k, (exp, _) in self._store.items() if now > exp]
        for k in expired:
            del self._store[k]
        if len(self._store) >= self._max_size:
            oldest = sorted(self._store.items(), key=lambda x: x[1][0])
            for k, _ in oldest[: len(oldest) // 4]:
                del self._store[k]
