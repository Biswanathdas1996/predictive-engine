"""Load per-task LLM settings from YAML (optional).

Set LLM_CONFIG_PATH to a YAML file, or place llm_config.yml at the repo root.
If the file is missing or PyYAML is unavailable, task-based resolution returns None.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[4]


@dataclass
class TaskLLMConfig:
    model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    timeout: int | None = None


_cached_path: str | None = None
_cached_mtime: float | None = None
_cached_tasks: dict[str, TaskLLMConfig] | None = None


def _config_file_path() -> Path:
    env = (os.environ.get("LLM_CONFIG_PATH") or "").strip()
    if env:
        return Path(env).expanduser().resolve()
    return (_REPO_ROOT / "llm_config.yml").resolve()


def _parse_task_entry(raw: Any) -> TaskLLMConfig | None:
    if not isinstance(raw, dict):
        return None
    model = raw.get("model")
    return TaskLLMConfig(
        model=str(model).strip() if model else None,
        temperature=float(raw["temperature"]) if raw.get("temperature") is not None else None,
        max_tokens=int(raw["max_tokens"]) if raw.get("max_tokens") is not None else None,
        timeout=int(raw["timeout"]) if raw.get("timeout") is not None else None,
    )


def load_llm_tasks() -> dict[str, TaskLLMConfig]:
    global _cached_path, _cached_mtime, _cached_tasks
    path = _config_file_path()
    try:
        st = path.stat()
    except OSError:
        _cached_path = str(path)
        _cached_mtime = None
        _cached_tasks = {}
        return {}

    key = str(path)
    if _cached_tasks is not None and _cached_path == key and _cached_mtime == st.st_mtime:
        return _cached_tasks

    try:
        import yaml  # type: ignore[import-untyped]
    except ImportError:
        _cached_path = key
        _cached_mtime = st.st_mtime
        _cached_tasks = {}
        return {}

    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    tasks: dict[str, TaskLLMConfig] = {}
    if isinstance(data, dict):
        for name, entry in data.items():
            if not isinstance(name, str):
                continue
            cfg = _parse_task_entry(entry)
            if cfg:
                tasks[name.strip()] = cfg

    _cached_path = key
    _cached_mtime = st.st_mtime
    _cached_tasks = tasks
    return tasks


def get_task_config(task_name: str | None) -> TaskLLMConfig | None:
    if not task_name:
        return None
    return load_llm_tasks().get(task_name.strip())
