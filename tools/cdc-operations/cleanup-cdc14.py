#!/usr/bin/env python3
"""Remove only inventoried, exited CDC-14 test clones after ownership checks."""

import argparse
import json
import subprocess
from pathlib import Path


def docker(*args):
    result = subprocess.run(["docker", *args], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"docker {args[0]} failed: {result.stderr.strip()[:240]}")
    return result.stdout.strip()


def inspect(kind, name):
    return json.loads(docker(kind, "inspect", name))[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    inventory = json.loads(args.inventory.read_text(encoding="utf-8"))
    projects = {item["name"] for item in inventory["compose_projects"]
                if item["classification"] == "exited_test_clone_candidate"}
    containers = [item["name"] for item in inventory["containers"]
                  if item["classification"] == "exited_test_clone"]
    volumes = [item["name"] for item in inventory["volumes"]
               if item["classification"] == "test_clone_candidate"]
    networks = [item["name"] for item in inventory["networks"]
                if item["classification"] == "test_clone_candidate"]
    if (len(projects), len(containers), len(volumes), len(networks)) != (5, 54, 31, 5):
        raise RuntimeError("inventory count guard failed")
    target_ids = set()
    for name in containers:
        item = inspect("container", name)
        project = item["Config"].get("Labels", {}).get("com.docker.compose.project")
        if item["State"]["Running"] or project not in projects:
            raise RuntimeError(f"container owner/state guard failed: {name}")
        target_ids.add(item["Id"])
    for name in volumes:
        item = inspect("volume", name)
        owner = item.get("Labels", {}).get("com.docker.compose.project")
        if owner not in projects and not (owner == "funnelmetry_cdc_shadow" and
                                          name.startswith("funnelmetry_cdc_shadow_")):
            raise RuntimeError(f"volume owner guard failed: {name}")
        refs = docker("ps", "-aq", "--filter", f"volume={name}").splitlines()
        if any(inspect("container", ref)["Id"] not in target_ids for ref in refs):
            raise RuntimeError(f"volume has non-test owner: {name}")
    for name in networks:
        item = inspect("network", name)
        if item.get("Labels", {}).get("com.docker.compose.project") not in projects:
            raise RuntimeError(f"network owner guard failed: {name}")
        if item.get("Containers"):
            raise RuntimeError(f"network still has attached container: {name}")
    result = {"status": "VERIFIED", "execute": args.execute,
              "projects": sorted(projects), "containers": len(containers),
              "named_volumes": len(volumes), "networks": len(networks)}
    print(json.dumps(result, sort_keys=True), flush=True)
    if args.execute:
        for name in containers:
            docker("rm", "-v", name)
        for name in volumes:
            docker("volume", "rm", name)
        for name in networks:
            docker("network", "rm", name)
        print(json.dumps({**result, "status": "REMOVED"}, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
