import unittest
from unittest.mock import patch

from target_shadow_workers import assert_same, worker_ids


class TargetShadowWorkersTest(unittest.TestCase):
    def test_exact_running_worker_required(self):
        with patch("target_shadow_workers.subprocess.run") as command:
            command.return_value.returncode = 0
            command.return_value.stdout = "a" * 12 + "\n"
            self.assertEqual(worker_ids(("catalog",)), {"catalog": "a" * 12})
            command.return_value.stdout = ""
            with self.assertRaisesRegex(RuntimeError, "not unique and running"):
                worker_ids(("catalog",))
            command.return_value.stdout = "a" * 12 + "\n" + "b" * 12
            with self.assertRaisesRegex(RuntimeError, "not unique and running"):
                worker_ids(("catalog",))

    def test_task_replacement_fails_closed(self):
        with patch("target_shadow_workers.worker_ids", return_value={"order_sink": "b" * 12}):
            with self.assertRaisesRegex(RuntimeError, "changed during"):
                assert_same({"order_sink": "a" * 12}, ("order_sink",))


if __name__ == "__main__":
    unittest.main()
