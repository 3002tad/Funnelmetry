import unittest
from analyze import compare


def snapshot(rows, counts):
    return dict(event_types=rows, sql_counts=counts, source_id='test',
                **{'from': '2026-09-20', 'to': '2026-09-21'})


class CompareTests(unittest.TestCase):
    def test_matching(self):
        result = compare(snapshot(['a', 'b', 'a'], {'a': 2, 'b': 1}))
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(result['total_events'], 3)

    def test_mismatch(self):
        self.assertEqual(compare(snapshot(['a'], {'b': 1}))['status'], 'FAIL')

    def test_empty_is_not_success(self):
        self.assertEqual(compare(snapshot([], {}))['status'], 'NO_DATA')

    def test_budget(self):
        with self.assertRaises(ValueError):
            compare(snapshot(['a'] * 10001, {'a': 10001}))

    def test_invalid(self):
        with self.assertRaises(ValueError):
            compare(snapshot([None], {}))


if __name__ == '__main__':
    unittest.main()
