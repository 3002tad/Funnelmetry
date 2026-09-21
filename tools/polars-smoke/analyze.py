"""Local operator smoke test, not an Agent tool or revenue metric."""
import json
import sys

import polars as pl


def compare(snapshot):
    rows = snapshot['event_types']
    if len(rows) > 10000:
        raise ValueError('row_budget_exceeded: narrow the SQL window before retrying')
    if any(not isinstance(value, str) or not value for value in rows):
        raise ValueError('invalid_event_type')
    frame = pl.DataFrame({'event_type': rows}, schema={'event_type': pl.String})
    counts = dict(frame.group_by('event_type').len(name='count').iter_rows())
    expected = snapshot['sql_counts']
    return {
        'tool_id': 'polars_event_count_smoke', 'version': '0.1.0',
        'polars_version': pl.__version__,
        'status': 'NO_DATA' if not rows else ('PASS' if counts == expected else 'FAIL'),
        'matches_sql': counts == expected,
        'source_id': snapshot['source_id'],
        'from': snapshot['from'], 'to': snapshot['to'],
        'grain': 'stored canonical event row', 'time_basis': 'occurred_at',
        'total_events': len(rows),
        'counts': [{'event_type': key, 'polars': counts.get(key, 0),
                    'sql': expected.get(key, 0)} for key in sorted(counts.keys() | expected.keys())],
        'limitations': ['Not revenue, unique source events or conversion.',
                        'Validates this read path and aggregation only, not end-to-end ingestion.'],
    }


if __name__ == '__main__':
    try:
        report = compare(json.load(sys.stdin))
        print(json.dumps(report, indent=2))
        sys.exit(0 if report['status'] == 'PASS' else 1)
    except (ValueError, KeyError, TypeError):
        print(json.dumps({'status': 'ERROR', 'error': 'invalid_or_over_budget_snapshot'}))
        sys.exit(2)
