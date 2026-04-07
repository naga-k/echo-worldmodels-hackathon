import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from diagnostics import analyze_prompt, select_spz_url


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


if __name__ == "__main__":
    unittest.main()
