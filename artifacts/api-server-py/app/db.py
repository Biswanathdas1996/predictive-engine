import asyncpg

from app.config import DATABASE_URL

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global _pool
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL must be set. Did you forget to provision a database?"
        )
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialized")
    return _pool
