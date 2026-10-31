#!/usr/bin/env python3
"""Remove only inventoried test/rollback images absent from live service specs."""

import argparse
import json
import subprocess
from pathlib import Path


def docker(*args):
    result = subprocess.run(["docker", *args], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"docker {args[0]} failed: {result.stderr.strip()[:200]}")
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    inventory = json.loads(args.inventory.read_text(encoding="utf-8"))
    candidates = [item for item in inventory["images"]
                  if item["classification"] == "test_or_backup_candidate"]
    if len(candidates) != 24:
        raise RuntimeError("image inventory count guard failed")
    container_ids = docker("ps", "-aq").splitlines()
    containers = json.loads(docker("container", "inspect", *container_ids))
    protected = {item["Image"] for item in containers}
    services = docker("service", "ls", "-q").splitlines()
    service_details = json.loads(docker("service", "inspect", *services))
    for service in service_details:
        ref = service["Spec"]["TaskTemplate"]["ContainerSpec"]["Image"]
        try:
            protected.add(json.loads(docker("image", "inspect", ref))[0]["Id"])
        except RuntimeError:
            pass  # service may specify a remote-only digest
    removal = []
    for item in candidates:
        image = json.loads(docker("image", "inspect", item["id"]))[0]
        if image["Id"] in protected:
            raise RuntimeError(f"candidate image still referenced: {item['id']}")
        removal.append((item["repository_tag"], image["Id"]))
    print(json.dumps({"status": "VERIFIED", "execute": args.execute,
                      "images": len(removal)}), flush=True)
    if args.execute:
        for tag, image_id in removal:
            docker("image", "rm", tag if "<none>" not in tag else image_id)
        print(json.dumps({"status": "REMOVED", "images": len(removal)}), flush=True)


if __name__ == "__main__":
    main()
