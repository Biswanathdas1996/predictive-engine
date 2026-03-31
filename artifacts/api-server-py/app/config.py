import importlib.util
import os
import re
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[3]
_ENV_STYLE_NAME = re.compile(r"^[A-Z][A-Z0-9_]*\Z")


def _apply_local_secrets_py(repo_root: Path) -> None:
    """Load repo-root local_secrets.py; set blank env vars from UPPER_SNAKE module attrs."""
    path = repo_root / "local_secrets.py"
    if not path.is_file():
        return
    spec = importlib.util.spec_from_file_location("local_secrets", path)
    if spec is None or spec.loader is None:
        return
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for name in dir(mod):
        if not _ENV_STYLE_NAME.match(name) or name.startswith("__"):
            continue
        val = getattr(mod, name, None)
        if val is None:
            continue
        if isinstance(val, bool):
            s = "true" if val else "false"
        else:
            s = str(val).strip()
        if not s:
            continue
        cur = os.environ.get(name)
        if cur is None or not str(cur).strip():
            os.environ[name] = s


def _apply_dotenv_blanks_only(env_file: Path) -> None:
    """For each key in .env with a non-empty value, set os.environ if missing or blank."""
    for key, val in dotenv_values(env_file).items():
        if not key:
            continue
        if val is None:
            continue
        s = str(val).strip()
        if not s:
            continue
        cur = os.environ.get(key)
        if cur is None or not str(cur).strip():
            os.environ[key] = s


# Default: do not override variables already set in the process environment.
# If .env values are ignored (e.g. empty keys defined in Windows User env), set
# DOTENV_OVERRIDE=1 when starting the API so repo .env wins.
_env_file = _REPO_ROOT / ".env"
if _env_file.is_file():
    load_dotenv(
        _env_file,
        override=os.environ.get("DOTENV_OVERRIDE", "").strip().lower()
        in ("1", "true", "yes"),
    )
    _apply_dotenv_blanks_only(_env_file)

_apply_local_secrets_py(_REPO_ROOT)


def _apply_legacy_pwc_genai_local_py(repo_root: Path) -> None:
    """Deprecated: pwc_genai_local.py — only PWC_GENAI_* still blank."""
    path = repo_root / "pwc_genai_local.py"
    if not path.is_file():
        return
    spec = importlib.util.spec_from_file_location("pwc_genai_local", path)
    if spec is None or spec.loader is None:
        return
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for name in dir(mod):
        if not name.startswith("PWC_GENAI_") or name.startswith("__"):
            continue
        val = getattr(mod, name, None)
        if val is None:
            continue
        s = str(val).strip()
        if not s:
            continue
        cur = os.environ.get(name)
        if cur is None or not str(cur).strip():
            os.environ[name] = s


_apply_legacy_pwc_genai_local_py(_REPO_ROOT)

DATABASE_URL = os.environ.get("DATABASE_URL")
PORT = int(os.environ.get("PORT", "3000"))

# Database pool
DB_POOL_MIN = int(os.environ.get("DB_POOL_MIN", "2"))
DB_POOL_MAX = int(os.environ.get("DB_POOL_MAX", "20"))

# Graph backend: "postgres" (default) or "neo4j"
# When set to "neo4j", the simulation engine reads the influence graph from
# Neo4j instead of PostgreSQL.  Falls back to postgres if Neo4j is unavailable.
GRAPH_BACKEND = os.environ.get("GRAPH_BACKEND", "postgres").lower()

# Auth
AUTH_MODE = os.environ.get("AUTH_MODE", "none")  # none | api_key | jwt

# CORS
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*")  # comma-separated origins

# Rate limiting
RATE_LIMIT_REQUESTS = int(os.environ.get("RATE_LIMIT_REQUESTS", "100"))
RATE_LIMIT_WINDOW = int(os.environ.get("RATE_LIMIT_WINDOW", "60"))  # seconds
