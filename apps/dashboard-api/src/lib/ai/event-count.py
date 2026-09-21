import json
import sys
import polars as pl

rows = json.load(sys.stdin)['event_types']
if len(rows) > 10000 or any(not isinstance(row, str) or len(row) > 128 for row in rows):
    raise ValueError('invalid_input')
frame = pl.DataFrame({'event_type': rows}, schema={'event_type': pl.String})
print(json.dumps({'total_events': len(rows), 'counts': frame.group_by('event_type').len(name='count').sort('event_type').to_dicts()}))
