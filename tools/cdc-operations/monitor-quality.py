#!/usr/bin/env python3
"""Primary CDC quality monitor entrypoint for the Medusa reference stack."""

import runpy
from pathlib import Path

engine = Path(__file__).resolve().parent / "verifier" / "monitor-target-quality.py"
runpy.run_path(str(engine), run_name="__main__")
