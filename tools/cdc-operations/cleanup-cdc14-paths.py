#!/usr/bin/env python3
"""Remove exact retired CDC-14 checkouts after live-reference checks."""

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path


ROOT = Path("/srv/KLTN")
NAMES = (
    "cdc-shadow", "cdc-shadow-cdc10", "cdc-shadow-catalog1",
    "cdc-shadow-inventory-price1", "cdc-shadow-inventory-price2",
    "Funnelmetry-cdc-combined", "Funnelmetry-cdc-workers-build",
    "dtc-starter-funnelmetry-pre-cdc12",
)


def output(*command):
    result = subprocess.run(command, text=True, capture_output=True, check=True)
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    paths = [ROOT / name for name in NAMES]
    for path in paths:
        if not path.is_dir() or path.is_symlink() or path.resolve().parent != ROOT:
            raise RuntimeError(f"unexpected checkout path: {path}")
    running = json.loads(output("docker", "inspect", *output("docker", "ps", "-q").split()))
    mounts = [Path(mount["Source"]) for item in running for mount in item.get("Mounts", [])
              if mount.get("Type") == "bind"]
    unit_files = [path for path in Path("/etc/systemd/system").rglob("*")
                  if path.is_file() and not path.is_symlink()]
    for path in paths:
        if any(mount == path or path in mount.parents for mount in mounts):
            raise RuntimeError(f"active container bind mount: {path}")
        if any(str(path) in unit.read_text(errors="replace") for unit in unit_files):
            raise RuntimeError(f"active unit reference: {path}")
        for entry in Path("/proc").glob("[0-9]*/cwd"):
            try:
                cwd = Path(os.readlink(entry))
            except OSError:
                continue
            if cwd == path or path in cwd.parents:
                raise RuntimeError(f"active process cwd: {path}")
    print(json.dumps({"status": "VERIFIED", "execute": args.execute,
                      "paths": [str(path) for path in paths]}), flush=True)
    if args.execute:
        for path in paths:
            shutil.rmtree(path)
        print(json.dumps({"status": "REMOVED", "count": len(paths)}), flush=True)


if __name__ == "__main__":
    main()
