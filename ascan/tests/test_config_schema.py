"""Guard against drift between ascan/config.schema.json (shared with the TS
server) and the pydantic Settings fields in src/config/settings.py.

Run: .venv/bin/python -m pytest tests/test_config_schema.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ASCAN_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ASCAN_ROOT))

from src.config.settings import Settings  # noqa: E402

SCHEMA = json.loads((ASCAN_ROOT / "config.schema.json").read_text(encoding="utf-8"))
SCHEMA_FIELDS = {f["key"]: f for f in SCHEMA["fields"]}

TYPE_MAP = {
    "string": str,
    "int": int,
    "string_list": list,
    "mp_list": list,
}


def test_schema_keys_exist_in_settings():
    missing = [key for key in SCHEMA_FIELDS if key not in Settings.model_fields]
    assert not missing, f"schema keys missing in Settings: {missing}"


def test_schema_defaults_match_settings():
    mismatches = []
    for key, field in SCHEMA_FIELDS.items():
        settings_field = Settings.model_fields.get(key)
        if settings_field is None:
            continue
        if settings_field.default != field["default"]:
            mismatches.append(f"{key}: schema={field['default']!r} settings={settings_field.default!r}")
    assert not mismatches, "default mismatches:\n" + "\n".join(mismatches)


def test_schema_types_match_settings_defaults():
    mismatches = []
    for key, field in SCHEMA_FIELDS.items():
        settings_field = Settings.model_fields.get(key)
        if settings_field is None:
            continue
        expected = TYPE_MAP[field["type"]]
        if not isinstance(settings_field.default, expected):
            mismatches.append(f"{key}: expected {expected.__name__}, default is {type(settings_field.default).__name__}")
    assert not mismatches, "type mismatches:\n" + "\n".join(mismatches)
