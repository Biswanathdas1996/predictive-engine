"""Authentication & authorization middleware.

Supports two modes (configured via AUTH_MODE env var):
- "api_key"  : simple shared-secret via X-API-Key header or ?api_key= query param
- "jwt"      : RS256 / HS256 JWT in Authorization: Bearer <token> header
- "none"     : no authentication (development only)

Enterprise deployments should set AUTH_MODE=jwt and configure the JWKS endpoint
or shared secret for token validation.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import time
from typing import Any

from fastapi import Depends, HTTPException, Request, Security
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)

_auth_mode: str = "none"
_api_keys: set[str] = set()
_jwt_secret: str = ""
_jwt_algorithm: str = "HS256"

# Security schemes (FastAPI will render these in OpenAPI)
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
_bearer_scheme = HTTPBearer(auto_error=False)


def init_auth() -> None:
    """Call once at startup to read env vars."""
    global _auth_mode, _api_keys, _jwt_secret, _jwt_algorithm

    _auth_mode = os.environ.get("AUTH_MODE", "none").lower()

    if _auth_mode == "api_key":
        raw = os.environ.get("API_KEYS", "")
        _api_keys = {k.strip() for k in raw.split(",") if k.strip()}
        if not _api_keys:
            logger.warning(
                "AUTH_MODE=api_key but API_KEYS is empty — all requests will be rejected"
            )
        else:
            logger.info("Auth: api_key mode with %d key(s)", len(_api_keys))

    elif _auth_mode == "jwt":
        _jwt_secret = os.environ.get("JWT_SECRET", "")
        _jwt_algorithm = os.environ.get("JWT_ALGORITHM", "HS256")
        if not _jwt_secret:
            logger.warning(
                "AUTH_MODE=jwt but JWT_SECRET is empty — all requests will be rejected"
            )
        else:
            logger.info("Auth: jwt mode (%s)", _jwt_algorithm)

    else:
        _auth_mode = "none"
        logger.info("Auth: disabled (AUTH_MODE=none) — NOT for production")


def _decode_jwt_hs256(token: str) -> dict[str, Any]:
    """Minimal HS256 JWT decode without external dependencies.

    For production with RS256/JWKS, replace with `python-jose` or `PyJWT`.
    """
    import base64

    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid JWT format")

    def _b64decode(s: str) -> bytes:
        padding = 4 - len(s) % 4
        return base64.urlsafe_b64decode(s + "=" * padding)

    header = json.loads(_b64decode(parts[0]))
    if header.get("alg") != "HS256":
        raise ValueError(f"Unsupported algorithm: {header.get('alg')}")

    payload = json.loads(_b64decode(parts[1]))

    # Verify signature
    import hashlib
    signing_input = f"{parts[0]}.{parts[1]}".encode()
    expected_sig = hmac.new(
        _jwt_secret.encode(), signing_input, hashlib.sha256
    ).digest()
    actual_sig = _b64decode(parts[2])
    if not hmac.compare_digest(expected_sig, actual_sig):
        raise ValueError("Invalid signature")

    # Check expiry
    if "exp" in payload and payload["exp"] < time.time():
        raise ValueError("Token expired")

    return payload


async def require_auth(
    request: Request,
    api_key: str | None = Security(_api_key_header),
    bearer: HTTPAuthorizationCredentials | None = Security(_bearer_scheme),
) -> dict[str, Any]:
    """FastAPI dependency that enforces authentication.

    Returns a dict with user info extracted from the credential.
    In 'none' mode, returns a placeholder identity.
    """
    if _auth_mode == "none":
        return {"sub": "anonymous", "mode": "none"}

    if _auth_mode == "api_key":
        key = api_key or request.query_params.get("api_key")
        if not key or key not in _api_keys:
            raise HTTPException(status_code=401, detail="Invalid or missing API key")
        return {"sub": "api_key_user", "mode": "api_key"}

    if _auth_mode == "jwt":
        if not bearer:
            raise HTTPException(
                status_code=401,
                detail="Missing Authorization: Bearer <token> header",
            )
        try:
            payload = _decode_jwt_hs256(bearer.credentials)
            return {"sub": payload.get("sub", "unknown"), "mode": "jwt", **payload}
        except ValueError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc

    raise HTTPException(status_code=500, detail="Unknown auth mode")
