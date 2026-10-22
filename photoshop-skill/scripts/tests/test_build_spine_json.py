import copy
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib


SCRIPT = Path(__file__).resolve().parents[1] / "build_spine_json.py"
SPEC = importlib.util.spec_from_file_location("build_spine_json", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def write_png(path, width, height):
    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data)))
    # Real decodable RGBA8: transparent border and opaque center pixels.
    rows = []
    for y in range(height):
        rows.append(b"\0" + b"".join(
            b"\xff\x80\0\xff" if 0 < x < width - 1 and 0 < y < height - 1
            else b"\0\0\0\0" for x in range(width)))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(b"".join(rows))) + chunk(b"IEND", b""))


class BuildSpineJsonTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "images").mkdir()
        for name in ("CS_eye", "KX_eye", "hair", "spark"):
            write_png(self.root / "images" / (name + ".png"), 5, 7)
        self.manifest = {
            "schema_version": 1,
            "poses": {"cs": {"origin": [10, 20]}, "kx": {"origin": [110, 20]}},
            "parts": [
                self.part("CS_eye", "eye", [7, 10, 12, 17], 5, True),
                self.part("hair", "hair", [-2, -3, 3, 4], 1, True),
                self.part("KX_eye", "eye", [107, 10, 112, 17], 5, False, "kx"),
                self.part("spark", "spark", [7, 10, 12, 17], 8, False),
                {"status": "pending", "reason": "ambiguous piece"},
            ],
        }

    def part(self, name, slot, box, order, setup, pose="cs"):
        return {"status": "exported", "file": name + ".png", "attachment": name,
                "slot": slot, "pose": pose, "export_box": box,
                "draw_order": order, "setup": setup}

    def build(self, version="3.8.99", output_dir=None):
        return MODULE.build_skeleton(self.manifest, self.root, output_dir or self.root, version)

    def test_positions_preserve_half_pixels_and_normalize_pose_origins(self):
        attachments = self.build()["skins"][0]["attachments"]["eye"]
        for name in ("CS_eye", "KX_eye"):
            self.assertEqual((attachments[name]["x"], attachments[name]["y"]), (-0.5, 6.5))
            self.assertEqual((attachments[name]["width"], attachments[name]["height"]), (5, 7))
            self.assertEqual(attachments[name]["path"], name)

    def test_draw_order_defaults_and_absent_setup_effect(self):
        result = self.build()
        self.assertEqual([slot["name"] for slot in result["slots"]], ["hair", "eye", "spark"])
        self.assertEqual(result["slots"][1]["attachment"], "CS_eye")
        self.assertNotIn("attachment", result["slots"][2])
        self.assertEqual(result["bones"], [{"name": "root"}])
        self.assertEqual(result["animations"], {})

    def test_supported_versions_use_skins_array(self):
        for version in ("3.8.99", "4.0.64", "4.1.24", "4.2.22"):
            with self.subTest(version=version):
                result = self.build(version)
                self.assertEqual(result["skeleton"]["spine"], version)
                self.assertEqual(result["skins"][0]["name"], "default")
        with self.assertRaises(ValueError):
            self.build("3.7.94")

    def test_images_path_is_relative_to_output(self):
        self.assertEqual(self.build(output_dir=self.root / "preview")["skeleton"]["images"], "../images/")

    def test_rejects_invalid_assets_and_mappings(self):
        original = copy.deepcopy(self.manifest)
        changes = [
            (0, "export_box", [7, 10, 13, 17]),
            (0, "export_box", [7, float("nan"), 12, 17]),
            (0, "file", "../outside.png"),
            (0, "file", "nested//CS_eye.png"),
            (0, "file", "missing.png"),
            (0, "file", "hair.png"),
            (0, "skin", "costume"),
            (0, "pose", "unknown"),
            (1, "draw_order", 5),
            (2, "setup", True),
            (2, "draw_order", 6),
            (2, "blend", "multiply"),
            (0, "setup", "true"),
        ]
        for index, key, value in changes:
            with self.subTest(key=key, value=value):
                self.manifest = copy.deepcopy(original)
                self.manifest["parts"][index][key] = value
                with self.assertRaises((ValueError, OSError)):
                    self.build()

    def test_cli_roundtrip_and_existing_output_protection(self):
        manifest = self.root / "spine_manifest.json"
        manifest.write_text(json.dumps(self.manifest), encoding="utf-8")
        command = [sys.executable, str(SCRIPT), str(manifest), "--spine-version", "3.8.99"]
        first = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        output = self.root / "spine_import.json"
        before = output.read_bytes()
        self.assertEqual(json.loads(before)["skeleton"]["images"], "images/")
        second = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(second.returncode, 0)
        self.assertEqual(output.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
