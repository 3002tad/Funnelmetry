#!/usr/bin/env python3
"""Primary CDC quality monitor entrypoint for the Medusa reference stack."""

import os
import runpy
from pathlib import Path

os.environ["CDC_RUNTIME_STACK"] = "funnelmetry_cdc"
legacy_engine = (Path(__file__).resolve().parents[1] /
                 "medusa-reference-cdc-shadow" / "monitor-target-quality.py")
runpy.run_path(str(legacy_engine), run_name="__main__")
