#!/usr/bin/env python3
"""Compare all golden SQL answers against a specified PostgreSQL container."""
import json
from pathlib import Path
import subprocess
import sys

if len(sys.argv) != 3:
    raise SystemExit('usage: verify-demo-golden-postgres.py <container> <database-user>')
base = Path(__file__).resolve().parent
expected = {item['id']: item for item in json.loads((base / 'demo-golden-v2-answers.json').read_text(encoding='utf-8'))['answers']}
sql = (base / 'demo-golden-v2.sql').read_bytes()
result = subprocess.run(['docker', 'exec', '-i', sys.argv[1], 'psql', '-X', '-A', '-t', '-q',
                         '-v', 'ON_ERROR_STOP=1', '-U', sys.argv[2], '-d', 'funnelmetry_handoff'],
                        input=sql, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
actual = [json.loads(line) for line in result.stdout.decode().splitlines() if line.strip()]
if len(actual) != 15 or len(expected) != 15:
    raise SystemExit('expected exactly 15 golden results')
for item in actual:
    baseline = dict(expected[item['id']])
    if item['id'] == 'Q15':
        item.pop('observed_browser_events_after_boundary', None)
        baseline.pop('observed_browser_events_after_boundary', None)
    if item != baseline:
        raise SystemExit('golden mismatch: ' + item['id'])
print(json.dumps({'status': 'PASS', 'questions': len(actual)}))
