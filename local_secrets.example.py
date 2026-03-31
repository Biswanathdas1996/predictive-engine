"""
Single local secrets file (copy to `local_secrets.py` at repo root — gitignored).

Load order for the Python API (`artifacts/api-server-py/app/config.py`):
  1. Optional `.env` via python-dotenv (DOTENV_OVERRIDE=1 replaces all from .env)
  2. Non-empty values from `.env` fill any blank os.environ slots (Windows empty vars)
  3. This module: any UPPER_SNAKE public names set os.environ if still blank

Node / Drizzle cannot import Python. After editing this file, run from repo root:
  pnpm secrets:export
That writes `secrets.dotenv` (gitignored). DB scripts load:
  --env-file=.env --env-file=secrets.dotenv
(later file wins for duplicate keys.)

Keep using `.env` for non-secret defaults if you like; put passwords and API keys here.
"""

# --- Database ---
DATABASE_URL = ""

# --- API server ---
# PORT = 3000

# --- Optional pool ---
# DB_POOL_MIN = 2
# DB_POOL_MAX = 20

# --- Auth (production) ---
# AUTH_MODE = "none"
# API_KEYS = ""
# JWT_SECRET = ""
# JWT_ALGORITHM = "HS256"

# --- CORS / rate limit ---
# CORS_ORIGINS = "*"
# RATE_LIMIT_REQUESTS = 100
# RATE_LIMIT_WINDOW = 60

# --- Neo4j (optional) ---
# NEO4J_URI = "bolt://localhost:7687"
# NEO4J_USER = "neo4j"
# NEO4J_PASSWORD = ""

# --- Simulation graph ---
# GRAPH_BACKEND = "postgres"

# --- PwC GenAI ---
# PWC_GENAI_ENDPOINT_URL = "https://genai-sharedservice-americas.pwc.com/completions"
PWC_GENAI_API_KEY = ""
PWC_GENAI_BEARER_TOKEN = ""
# PWC_GENAI_AUTH_MODE = "auto"  # bearer | api_key | both — use if GenAI returns 5xx with duplicate auth
# PWC_GENAI_MODEL = ""
# PWC_GENAI_STRICT_PROBE = ""
# PWC_GENAI_SKIP_PROBE = ""

# --- Vertex (policy docs) ---
# GOOGLE_CLOUD_PROJECT = ""
# VERTEX_AI_LOCATION = "us-central1"
# VERTEX_AI_MODEL = ""

# --- Vite proxy / local LLM (optional; export script stringifies for Node) ---
# API_PORT = 3000
# OLLAMA_BASE_URL = "http://localhost:11434"
# OLLAMA_MODEL = ""
