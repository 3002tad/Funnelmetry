#!/usr/bin/env python3
"""Create one synthetic Store API order on the CDC-11 reference VPS.

This intentionally writes a real order to the test Medusa deployment. It
keeps the publishable API token out of Git and logs; the native adapter and
CDC shadow both observe the same checkout through separate outputs.
"""

import argparse
import importlib.util
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("target_source_installer", ROOT / "install-target-source.py")
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--postgres-container", required=True)
    parser.add_argument("--backend-container", required=True)
    parser.add_argument("--publishable-key-id", required=True)
    parser.add_argument("--acknowledge-live-reference-order", action="store_true")
    args = parser.parse_args()
    if not args.acknowledge_live_reference_order:
        raise ValueError("explicit live reference test-order acknowledgement required")
    if args.postgres_container != "medusa_reference-postgres-1" or \
            args.backend_container != "medusa_reference-backend-1" or \
            not re.fullmatch(r"apk_[A-Za-z0-9]+", args.publishable_key_id):
        raise ValueError("CDC-11 Medusa source/backend and publishable key ID required")
    value = source.run_psql(args.postgres_container,
        "SELECT token FROM api_key WHERE id='" + args.publishable_key_id +
        "' AND type='publishable' AND revoked_at IS NULL AND deleted_at IS NULL;")
    if not re.fullmatch(r"[A-Za-z0-9._-]{12,256}", value):
        raise ValueError("expected one active publishable key")
    script = (ROOT / "checkout-shadow.mjs").read_text(encoding="utf-8")
    result = subprocess.run(["docker", "exec", "-i", "-e",
                             f"SHADOW_PUBLISHABLE_KEY={value}", args.backend_container,
                             "node", "-"], input=script, text=True,
                            capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f"target Store checkout failed (exit {result.returncode}); inspect protected logs")
    lines = [line for line in result.stdout.splitlines() if re.fullmatch(
        r"(?:shadow_cart|shadow_order|completion_type)=[A-Za-z0-9_]+", line)]
    if not any(line.startswith("shadow_order=order_") for line in lines):
        raise ValueError("checkout returned no order")
    print("\n".join(lines))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        raise SystemExit(f"cdc-target-checkout: {error}") from None
