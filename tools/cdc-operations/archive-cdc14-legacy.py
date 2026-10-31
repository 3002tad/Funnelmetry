#!/usr/bin/env python3
"""Move exact retired CDC operator artifacts out of the active VPS root."""

import argparse
import json
import os
import subprocess
from pathlib import Path


ROOT = Path("/srv/KLTN")
ARCHIVE = ROOT / ".cdc14-backups" / "legacy-operator-artifacts"
NAMES = (
    ".cdc11-topic-bootstrap", ".cdc11-tools", ".cdc11-profiles",
    ".cdc11-moving-probe", ".cdc11-migration027", ".cdc12-stage2",
    ".cdc12-order-v2", ".cdc12-catalog-service-before-20261030.json",
    ".cdc11-install-target-source.py", ".cdc11-check-cdc-source-config.mjs",
    ".cdc11-funnel-api-query.sql",
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    paths = [ROOT / name for name in NAMES]
    ids = subprocess.check_output(["docker", "ps", "-q"], text=True).split()
    containers = json.loads(subprocess.check_output(["docker", "inspect", *ids], text=True))
    mounts = [Path(m["Source"]) for item in containers for m in item.get("Mounts", [])
              if m.get("Type") == "bind"]
    units = [p for p in Path("/etc/systemd/system").rglob("*")
             if p.is_file() and not p.is_symlink()]
    for path in paths:
        if not path.exists() or path.is_symlink() or path.resolve().parent != ROOT:
            raise RuntimeError(f"unexpected archive source: {path}")
        if (ARCHIVE / path.name).exists():
            raise RuntimeError(f"archive destination exists: {path.name}")
        if any(m == path or path in m.parents for m in mounts):
            raise RuntimeError(f"active bind mount: {path}")
        if any(str(path) in unit.read_text(errors="replace") for unit in units):
            raise RuntimeError(f"systemd unit references: {path}")
        for entry in Path("/proc").glob("[0-9]*/cwd"):
            try:
                cwd = Path(os.readlink(entry))
            except OSError:
                continue
            if cwd == path or path in cwd.parents:
                raise RuntimeError(f"active process cwd: {path}")
    print(json.dumps({"status": "VERIFIED", "count": len(paths),
                      "execute": args.execute}), flush=True)
    if args.execute:
        ARCHIVE.mkdir(mode=0o700, parents=True, exist_ok=False)
        for path in paths:
            path.rename(ARCHIVE / path.name)
        print(json.dumps({"status": "ARCHIVED", "count": len(paths),
                          "path": str(ARCHIVE)}), flush=True)


if __name__ == "__main__":
    main()
