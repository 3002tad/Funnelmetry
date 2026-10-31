"""Exact task identity guard for moving-quality CDC-11 candidate probes."""

import re
import os
import subprocess


CDC_STACK = os.environ.get("CDC_RUNTIME_STACK", "funnelmetry_cdc_target_shadow")
if not re.fullmatch(r"funnelmetry_cdc(?:_target_shadow)?", CDC_STACK):
    raise ValueError("unsupported CDC runtime stack")
SERVICES = {
    "catalog": f"{CDC_STACK}_catalog-writer",
    "inventory_price": f"{CDC_STACK}_inventory-price-writer",
    "order_mapper": f"{CDC_STACK}_order-mapper",
    "order_sink": f"{CDC_STACK}_order-sink",
}


def worker_ids(names):
    if not names or any(name not in SERVICES for name in names):
        raise ValueError("unknown CDC target worker")
    result = {}
    for name in names:
        completed = subprocess.run(["docker", "ps", "-q", "--filter",
            f"label=com.docker.swarm.service.name={SERVICES[name]}"],
            text=True, capture_output=True, check=False)
        ids = completed.stdout.strip().splitlines()
        if (completed.returncode or len(ids) != 1 or
                not re.fullmatch(r"[a-f0-9]{12,64}", ids[0])):
            raise RuntimeError(f"{name} CDC target worker is not unique and running")
        result[name] = ids[0]
    return result


def assert_same(before, names):
    if worker_ids(names) != before:
        raise RuntimeError("CDC target worker changed during moving quality sample")
