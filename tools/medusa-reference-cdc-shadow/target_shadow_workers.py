"""Exact task identity guard for moving-quality CDC-11 candidate probes."""

import re
import subprocess


SERVICES = {
    "catalog": "funnelmetry_cdc_target_shadow_catalog-writer",
    "inventory_price": "funnelmetry_cdc_target_shadow_inventory-price-writer",
    "order_mapper": "funnelmetry_cdc_target_shadow_order-mapper",
    "order_sink": "funnelmetry_cdc_target_shadow_order-sink",
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
