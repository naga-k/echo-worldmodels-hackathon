import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from diagnostics import analyze_prompt, prompt_requires_rewrite, select_spz_url


class DiagnosticsHelpersTest(unittest.TestCase):
    def test_select_spz_prefers_full_res(self):
        url, tier = select_spz_url(
            {
                "500k": "https://example.com/500k.spz",
                "100k": "https://example.com/100k.spz",
                "full_res": "https://example.com/full.spz",
            },
            "full_res",
        )
        self.assertEqual(tier, "full_res")
        self.assertEqual(url, "https://example.com/full.spz")

    def test_prompt_analysis_flags_shot_like_prompts(self):
        analysis = analyze_prompt(
            "A close-up of a weathered stone doorway with intricate carvings and moss in the cracks.",
            caption="The doorway dominates the scene.",
            world_prompt_text="The doorway dominates the scene with detailed carvings and moss.",
        )
        self.assertIn("shot-like framing", analysis["warnings"])
        self.assertIn("object vignette", analysis["warnings"])
        self.assertTrue(prompt_requires_rewrite(analysis))

    def test_prompt_analysis_flags_missing_rear_context(self):
        analysis = analyze_prompt(
            "A circular stone room with a brass telescope aimed through a wide opening toward the sea. A desk with maps sits to the right.",
        )
        self.assertIn("missing rear context", analysis["warnings"])
        self.assertTrue(prompt_requires_rewrite(analysis))

    def test_prompt_analysis_accepts_well_formed_room_prompt(self):
        analysis = analyze_prompt(
            "A circular stone observatory with pale walls, a dark wood floor, and a domed ceiling. "
            "A brass telescope stands left of center facing a large sea-facing opening. "
            "A heavy oak desk with maps and a lantern sits against the right wall, while floor-to-ceiling bookcases line the back wall behind the viewer."
        )
        self.assertNotIn("shot-like framing", analysis["warnings"])
        self.assertNotIn("object vignette", analysis["warnings"])
        self.assertNotIn("missing enclosure", analysis["warnings"])
        self.assertNotIn("missing rear context", analysis["warnings"])
        self.assertFalse(prompt_requires_rewrite(analysis))


if __name__ == "__main__":
    unittest.main()
