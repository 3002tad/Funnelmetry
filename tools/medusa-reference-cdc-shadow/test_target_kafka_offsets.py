import unittest

from target_kafka_offsets import parse_topic_ends


class TargetKafkaOffsetsTest(unittest.TestCase):
    def test_selects_exact_topics_among_internal_offsets(self):
        output = "__consumer_offsets:0:42\na:0:0\nb:0:12\n"
        self.assertEqual(parse_topic_ends(output, ["a", "b"]), {"a": 0, "b": 12})

    def test_rejects_missing_duplicate_and_extra_partition(self):
        with self.assertRaises(ValueError):
            parse_topic_ends("a:0:1\n", ["a", "b"])
        with self.assertRaises(ValueError):
            parse_topic_ends("a:0:1\na:0:2\n", ["a"])
        with self.assertRaises(ValueError):
            parse_topic_ends("a:0:1\na:1:2\n", ["a"])


if __name__ == "__main__":
    unittest.main()
