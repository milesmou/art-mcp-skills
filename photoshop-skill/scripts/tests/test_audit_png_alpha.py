"""Exercise trim failures while preserving intentional soft edges and padding."""

import importlib.util
from pathlib import Path
import unittest

from PIL import Image, ImageDraw

script = Path(__file__).resolve().parents[1] / "audit_png_alpha.py"
spec = importlib.util.spec_from_file_location("audit_png_alpha", script)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AlphaAuditTest(unittest.TestCase):
    def test_faint_one_pixel_tail_requests_review_without_changing_pixels(self):
        alpha = Image.new("L", (100, 120))
        draw = ImageDraw.Draw(alpha)
        draw.rectangle((0, 0, 99, 59), fill=255)
        draw.line((99, 61, 99, 119), fill=13)
        before = alpha.tobytes()
        result = audit.inspect_alpha(alpha)
        self.assertEqual(result["status"], "review")
        self.assertEqual(result["alpha_bbox"], [0, 0, 100, 120])
        self.assertEqual(result["core_bbox"], [0, 0, 100, 60])
        self.assertEqual([e["side"] for e in result["suspect_edges"]], ["bottom"])
        self.assertEqual(alpha.tobytes(), before)

    def test_dense_soft_shadow_is_not_classified_as_sparse_residue(self):
        alpha = Image.new("L", (60, 80))
        draw = ImageDraw.Draw(alpha)
        draw.rectangle((5, 5, 54, 74), fill=16)
        draw.rectangle((10, 10, 49, 59), fill=255)
        result = audit.inspect_alpha(alpha)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["alpha_bbox"], [5, 5, 55, 75])

    def test_short_antialias_fringe_is_preserved(self):
        alpha = Image.new("L", (20, 20), 4)
        ImageDraw.Draw(alpha).rectangle((1, 1, 18, 18), fill=255)
        self.assertEqual(audit.inspect_alpha(alpha)["status"], "ok")

    def test_faint_intended_artwork_requests_review_instead_of_becoming_empty(self):
        alpha = Image.new("L", (50, 50))
        ImageDraw.Draw(alpha).ellipse((10, 10, 39, 39), outline=20)
        result = audit.inspect_alpha(alpha)
        self.assertEqual(result["status"], "review")
        self.assertEqual(result["reason"], "low_alpha_only")
        self.assertIsNotNone(result["alpha_bbox"])

    def test_fixed_and_shared_canvases_keep_expected_padding(self):
        alpha = Image.new("L", (100, 100))
        ImageDraw.Draw(alpha).rectangle((30, 30, 69, 69), fill=255)
        for mode in ["fixed", "shared"]:
            with self.subTest(mode=mode):
                self.assertEqual(audit.inspect_alpha(alpha, mode)["status"], "expected_padding")

    def test_empty_image_is_reported_even_on_fixed_canvas(self):
        self.assertEqual(audit.inspect_alpha(Image.new("L", (10, 10)), "fixed")["status"], "empty")


if __name__ == "__main__":
    unittest.main()
