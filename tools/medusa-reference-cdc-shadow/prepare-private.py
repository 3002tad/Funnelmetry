#!/usr/bin/env python3
"""Create local-only credentials for the disposable CDC shadow environment.

The command is idempotent: existing secret files are never overwritten.
"""

import json
import os
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PRIVATE = ROOT / "private"
PRIVATE.mkdir(mode=0o700, exist_ok=True)
os.chmod(PRIVATE, 0o700)
FILES = ("postgres.env", "backend.env", "source-ingress.env", "connector.env")
existing = [name for name in FILES if (PRIVATE / name).exists()]
if existing:
    if len(existing) != len(FILES):
        raise SystemExit("partial private configuration exists; inspect it before retrying")
    for name in FILES:
        if (PRIVATE / name).stat().st_mode & 0o077:
            raise SystemExit(f"unsafe permissions on {name}")
    print("preserved existing private configuration")
    raise SystemExit(0)


def put(name: str, fields: dict[str, str]) -> None:
    path = PRIVATE / name
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as error:
        raise SystemExit(f"refusing to overwrite {name}") from error
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        for key, value in fields.items():
            if "\n" in value or "\r" in value:
                raise ValueError(f"newline in {key}")
            stream.write(f"{key}={value}\n")
    print(f"created {name}")


db_password = secrets.token_hex(24)
signing_key = secrets.token_hex(32)
replication_password = secrets.token_hex(24)

put("postgres.env", {
    "POSTGRES_DB": "medusa",
    "POSTGRES_USER": "medusa",
    "POSTGRES_PASSWORD": db_password,
})
put("backend.env", {
    "DATABASE_URL": f"postgres://medusa:{db_password}@postgres:5432/medusa?sslmode=disable",
    "REDIS_URL": "redis://redis:6379",
    "REDIS_PREFIX": "cdc-shadow:",
    "STORE_CORS": "http://127.0.0.1:19000",
    "ADMIN_CORS": "http://127.0.0.1:19000",
    "AUTH_CORS": "http://127.0.0.1:19000",
    "JWT_SECRET": secrets.token_hex(32),
    "COOKIE_SECRET": secrets.token_hex(32),
    "MEDUSA_COOKIE_SECURE": "false",
    "FUNNELMETRY_INGEST_URL": "http://source-ingress:32000/v1/ingress/events",
    "FUNNELMETRY_BACKEND_SIGNING_KEY": signing_key,
})
put("source-ingress.env", {
    "SOURCE_INGRESS_HOST": "0.0.0.0",
    "SOURCE_INGRESS_PORT": "32000",
    "SOURCE_INGRESS_DATABASE_PATH": "/var/lib/funnelmetry-source-event-log/source-event-log.sqlite",
    "SOURCE_INGRESS_MAX_EVENT_LOG_BYTES": "268435456",
    "SOURCE_INGRESS_MAX_EVENT_LOG_EVENTS": "10000",
    "SOURCE_INGRESS_MIN_FREE_DISK_BYTES": "268435456",
    "SOURCE_INGRESS_BACKEND_KEYS_JSON": json.dumps({
        "medusa-reference-source": {"secret": signing_key, "source_id": "medusa-reference"}
    }, separators=(",", ":")),
    "SOURCE_INGRESS_BROWSER_KEYS_JSON": "{}",
    "SOURCE_INGRESS_EVENT_FEED_TOKENS_JSON": json.dumps({
        "shadow-reader": secrets.token_hex(32)
    }, separators=(",", ":")),
    "SOURCE_INGRESS_ADMIN_TOKEN": secrets.token_hex(32),
})
put("connector.env", {"CDC_SHADOW_REPLICATION_PASSWORD": replication_password})
