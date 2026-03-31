"""In-memory sliding-window rate limiter middleware.

For production, replace the in-memory store with Redis (or use a gateway-level
rate limiter like AWS API Gateway / Kong / Nginx).
"""

from __future__ import annotations

import time
from collections import defaultdict

from fastapi import HTTPException, Request


class RateLimiter:
    """Per-IP sliding window counter."""

    def __init__(self, max_requests: int = 100, window_seconds: int = 60) -> None:
        self.max_requests = max_requests
        self.window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)

    def _cleanup(self, key: str, now: float) -> None:
        cutoff = now - self.window
        self._hits[key] = [t for t in self._hits[key] if t > cutoff]

    def check(self, key: str) -> None:
        now = time.monotonic()
        self._cleanup(key, now)
        if len(self._hits[key]) >= self.max_requests:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "Rate limit exceeded",
                    "retryAfterSeconds": self.window,
                },
            )
        self._hits[key].append(now)


# Singleton — initialised in main.py lifespan
_limiter: RateLimiter | None = None


def init_rate_limiter(max_requests: int, window_seconds: int) -> None:
    global _limiter
    _limiter = RateLimiter(max_requests, window_seconds)


async def rate_limit_dependency(request: Request) -> None:
    """FastAPI dependency — inject into routes or router-level dependencies."""
    if _limiter is None:
        return  # limiter not configured → pass through
    client_ip = request.client.host if request.client else "unknown"
    _limiter.check(client_ip)
