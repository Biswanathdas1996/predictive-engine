#!/usr/bin/env python3
"""Emit repo-root secrets.dotenv from local_secrets.py for Node --env-file."""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_LOCAL = _ROOT / "local_secrets.py"
_OUT = _ROOT / "secrets.dotenv"
_NAME_OK = re.compile(r"^[A-Z][A-Z0-9_]*\Z")


def _to_str(val: object) -> str:
    if isinstance(val, bool):
        return "true" if val else "false"
    return str(val).strip()


def _escape_dotenv_value(s: str) -> str:
    if s == "":
        return '""'
    if any(c in s for c in '\n\r"\\#') or " " in s or s.startswith("#"):
        inner = s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "\\r")
        return f'"{inner}"'
    return s


def main() -> int:
    if not _LOCAL.is_file():
        _OUT.write_text("", encoding="utf-8")
        print("local_secrets.py not found; wrote empty secrets.dotenv", file=sys.stderr)
        return 0

    spec = importlib.util.spec_from_file_location("local_secrets", _LOCAL)
    if spec is None or spec.loader is None:
        print("Could not load local_secrets.py", file=sys.stderr)
        return 1
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    lines: list[str] = []
    for name in sorted(dir(mod)):
        if not _NAME_OK.match(name) or name.startswith("__"):
            continue
        val = getattr(mod, name, None)
        if val is None:
            continue
        s = _to_str(val)
        if not s:
            continue
        lines.append(f"{name}={_escape_dotenv_value(s)}")

    _OUT.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    print(f"Wrote {_OUT.relative_to(_ROOT)} ({len(lines)} keys)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
