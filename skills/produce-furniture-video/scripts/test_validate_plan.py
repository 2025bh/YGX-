import copy
import json
from pathlib import Path
import unittest

from validate_plan import validate


class PlanTests(unittest.TestCase):
    def setUp(self):
        template = Path(__file__).resolve().parents[1] / "assets/shot-plan.example.json"
        self.plan = json.loads(template.read_text(encoding="utf-8"))

    def test_valid(self):
        self.assertEqual(validate(self.plan), [])

    def test_duplicate_original(self):
        self.plan["shots"][1]["source_id"] = "original-001"
        self.assertTrue(any("repeated source_id" in e for e in validate(self.plan)))

    def test_duplicate_hash_case_insensitive(self):
        self.plan["shots"][1]["source_sha256"] = "A" * 64
        self.assertTrue(any("repeated source_sha256" in e for e in validate(self.plan)))

    def test_short_ordinary(self):
        self.plan["shots"][0]["end_frame"] = 30
        self.assertTrue(any("below 1.5" in e for e in validate(self.plan)))

    def test_long_ordinary(self):
        self.plan["shots"][0]["end_frame"] = 150
        self.assertTrue(any("exceeds 4" in e for e in validate(self.plan)))

    def test_head_tail(self):
        self.plan["shots"][0]["source_start_seconds"] = 0
        self.assertTrue(any("margin" in e for e in validate(self.plan)))

    def test_pretrimmed_requires_evidence(self):
        self.plan["shots"][0].update(pretrimmed_verified=True, trim_evidence=None)
        self.assertTrue(any("provenance" in e for e in validate(self.plan)))

    def test_quick_cut_requires_product_list(self):
        self.plan["shots"][0]["quick_cut"] = True
        self.assertTrue(any("distinct product" in e for e in validate(self.plan)))

    def test_valid_product_quick_cut(self):
        shot = copy.deepcopy(self.plan["shots"][0])
        shot.update(end_frame=24, source_end_seconds=1.8, caption="sofa, table and wardrobe", quick_cut=True, listed_products=["sofa", "table", "wardrobe"], matched_product="sofa", quick_cut_reason="consecutive different products")
        self.plan.update(shots=[shot], total_frames=24)
        self.assertEqual(validate(self.plan), [])

    def test_horizontal_rejected(self):
        self.plan["shots"][0]["source_aspect"] = "16:9"
        self.assertTrue(any("source must" in e for e in validate(self.plan)))

    def test_linked_text_rejected(self):
        self.plan["texts"].append(copy.deepcopy(self.plan["texts"][0]))
        self.assertTrue(any("linked/repeated" in e for e in validate(self.plan)))

    def test_sync_rejected(self):
        self.plan["texts"][0]["subtitle_sync"] = True
        self.assertTrue(any("sync must" in e for e in validate(self.plan)))

    def test_excluded_path(self):
        self.plan["shots"][0]["source_path"] = "source/\u6682\u65f6\u4e0d\u53ef\u7528/a.mp4"
        self.assertTrue(any("excluded" in e for e in validate(self.plan)))

    def test_frame_gap(self):
        self.plan["shots"][1]["start_frame"] = 91
        self.assertTrue(any("gap" in e for e in validate(self.plan)))

    def test_invalid_fps(self):
        self.plan["fps"] = False
        self.assertTrue(validate(self.plan))


if __name__ == "__main__":
    unittest.main(verbosity=2)
