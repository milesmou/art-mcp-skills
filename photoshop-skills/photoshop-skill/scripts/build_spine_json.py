#!/usr/bin/env python3
"""Build a root-only Spine setup skeleton from a measured slice manifest (stdlib)."""

import argparse
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import struct


def vector(value, length, label, integer=False):
    if not isinstance(value, list) or len(value) != length:
        raise ValueError(f"{label}: expected {length} numbers")
    for number in value:
        if (isinstance(number, bool) or not isinstance(number, (int, float))
                or not math.isfinite(number) or (integer and int(number) != number)):
            raise ValueError(f"{label}: invalid coordinate {number!r}")
    return value


def relative_path(value, label):
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError(f"{label}: use a nonempty relative path with forward slashes")
    path = PurePosixPath(value)
    if path.is_absolute() or any(p in ("", ".", "..") for p in value.split("/")) or ":" in value:
        raise ValueError(f"{label}: path must stay inside the delivery directory")
    return path


def asset_name(value, label):
    relative_path(value, label)
    if not re.fullmatch(r"[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*", value):
        raise ValueError(f"{label}: use stable ASCII names")
    reserved = {"con", "prn", "aux", "nul"} | {
        f"{prefix}{i}" for prefix in ("com", "lpt") for i in range(1, 10)
    }
    if any(p.casefold() in reserved for p in value.split("/")):
        raise ValueError(f"{label}: reserved filename")
    return value


def png_size(path):
    with path.open("rb") as stream:
        header = stream.read(33)
    if (len(header) != 33 or header[:8] != b"\x89PNG\r\n\x1a\n"
            or header[8:16] != b"\x00\x00\x00\rIHDR"):
        raise ValueError(f"Not a PNG with an IHDR: {path}")
    width, height, depth, color = struct.unpack(">IIBB", header[16:26])
    if width < 1 or height < 1 or depth != 8 or color != 6:
        raise ValueError(f"Expected nonzero RGBA8 PNG: {path}")
    return width, height


def build_skeleton(manifest, manifest_dir, output_dir, version):
    # Minimal region data uses the skins array shared by these releases.
    # This is deliberately not a converter for existing rigs or animations.
    if not re.fullmatch(r"(?:3\.8|4\.[012])\.\d+", version):
        raise ValueError("Use an exact 3.8.x or 4.0.x–4.2.x version; other schemas need verification")
    if manifest.get("schema_version") != 1:
        raise ValueError("Expected manifest schema_version 1")
    poses = manifest.get("poses")
    if not isinstance(poses, dict) or not poses:
        raise ValueError("Expected poses with measured origins")
    images_value = manifest.get("images_dir", "images")
    relative_path(images_value, "images_dir")
    manifest_dir = Path(manifest_dir).resolve()
    images_dir = (manifest_dir / images_value).resolve()
    if not images_dir.is_relative_to(manifest_dir):
        raise ValueError("images_dir resolves outside the delivery directory")
    parts = manifest.get("parts")
    if not isinstance(parts, list):
        raise ValueError("Expected parts array")
    slots, attachments, orders, used_files = {}, {}, {}, set()
    for part in parts:
        if part.get("status") != "exported":
            continue
        if part.get("skin", "default") != "default":
            raise ValueError("This helper only builds default skin attachments")
        slot_name = asset_name(part.get("slot"), "slot")
        name = asset_name(part.get("attachment"), "attachment")
        filename = part.get("file")
        relative = relative_path(filename, "file")
        if relative.suffix != ".png":
            raise ValueError(f"Expected .png extension: {filename}")
        texture_name = asset_name(str(relative.with_suffix("")), "image path")
        file_key = filename.casefold()
        if file_key in used_files:
            raise ValueError(f"Duplicate image path: {filename}; record reuse outside exported parts")
        used_files.add(file_key)
        image = (images_dir / filename).resolve()
        if not image.is_relative_to(images_dir):
            raise ValueError(f"Image resolves outside images_dir: {filename}")
        box = vector(part.get("export_box"), 4, name + ".export_box", integer=True)
        left, top, right, bottom = box
        if right <= left or bottom <= top:
            raise ValueError(f"Invalid export_box: {name}")
        width, height = png_size(image)
        if (right - left, bottom - top) != (width, height):
            raise ValueError(f"PNG size differs from export_box: {filename}")
        pose = part.get("pose")
        if pose not in poses:
            raise ValueError(f"Unknown pose: {pose}")
        ox, oy = vector(poses[pose].get("origin"), 2, str(pose) + ".origin")
        order = part.get("draw_order")
        if isinstance(order, bool) or not isinstance(order, int) or order < 0:
            raise ValueError(f"draw_order must be a nonnegative integer: {name}")
        if not isinstance(part.get("setup"), bool):
            raise ValueError(f"setup must explicitly be true or false: {name}")
        blend = part.get("blend", "normal")
        if blend not in ("normal", "additive", "multiply", "screen"):
            raise ValueError(f"Unsupported slot blend: {blend}")
        if slot_name not in slots:
            if order in orders:
                raise ValueError(f"Two different slots have draw_order {order}")
            orders[order] = slot_name
            slots[slot_name] = {"name": slot_name, "bone": "root", "blend": blend}
            attachments[slot_name] = {}
        slot = slots[slot_name]
        if orders.get(order) != slot_name or slot["blend"] != blend:
            raise ValueError(f"Alternatives in slot {slot_name} must share draw_order and blend")
        if name in attachments[slot_name]:
            raise ValueError(f"Duplicate attachment in slot {slot_name}: {name}")
        if part["setup"]:
            if "attachment" in slot:
                raise ValueError(f"Multiple setup attachments in slot: {slot_name}")
            slot["attachment"] = name
        attachments[slot_name][name] = {
            "type": "region", "path": texture_name,
            "x": (left + right) / 2 - ox,
            "y": oy - (top + bottom) / 2,
            "width": width, "height": height,
        }
    if not slots:
        raise ValueError("No exported parts; refusing an empty import skeleton")
    images_path = Path(os.path.relpath(images_dir, Path(output_dir).resolve())).as_posix() + "/"
    return {
        "skeleton": {"spine": version, "images": images_path},
        "bones": [{"name": "root"}],
        "slots": [slots[orders[order]] for order in sorted(orders)],
        "skins": [{"name": "default", "attachments": attachments}],
        "animations": {},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--spine-version", required=True, help="Exact target editor version, e.g. 3.8.99")
    parser.add_argument("--output", type=Path, help="New JSON path (default: beside manifest)")
    args = parser.parse_args()
    output = args.output or args.manifest.parent / "spine_import.json"
    try:
        if output.suffix.lower() != ".json":
            raise ValueError("Output must be .json, never a .spine project")
        manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
        result = build_skeleton(manifest, args.manifest.parent, output.parent, args.spine_version)
        output.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive create prevents accidental replacement of existing deliverables.
        with output.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        parser.exit(1, f"error: {error}\n")
    print(json.dumps({"output": str(output.resolve()), "slots": len(result["slots"]),
                      "attachments": sum(len(a) for a in result["skins"][0]["attachments"].values()),
                      "verification": "structure_and_png_headers_only"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
