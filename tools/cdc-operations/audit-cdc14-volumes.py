#!/usr/bin/env python3
"""List owners of remaining anonymous Docker volumes without changing them."""

import json
import re
import subprocess


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


for volume in docker("volume", "ls", "-q").splitlines():
    if not re.fullmatch(r"[a-f0-9]{64}", volume):
        continue
    ids = docker("ps", "-aq", "--filter", f"volume={volume}").splitlines()
    owners = []
    for item in ids:
        details = json.loads(docker("container", "inspect", item))[0]
        owners.append({"name": details["Name"].lstrip("/"),
                       "running": details["State"]["Running"]})
    print(json.dumps({"volume": volume, "owners": owners}, sort_keys=True))
