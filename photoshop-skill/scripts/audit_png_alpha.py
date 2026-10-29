"""Read-only PNG audit for sparse, low-alpha tails that defeat transparent trim.

Requires Pillow. Findings request visual review; this tool never removes pixels.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


def inspect_alpha(alpha: Image.Image, crop_mode: str = "tight", *,
                  core_alpha: int = 32, min_extension: int = 8,
                  max_density: float = 0.02) -> dict:
    """Compare all nonzero pixels with a diagnostic higher-opacity core."""
    if not 0 <= core_alpha < 255 or min_extension < 1 or not 0 < max_density <= 1:
        raise ValueError("Invalid diagnostic thresholds")
    raw = alpha.getbbox()
    core = alpha.point(lambda value: 255 if value > core_alpha else 0).getbbox()
    result = dict(alpha_bbox=list(raw) if raw else None,
                  core_bbox=list(core) if core else None, crop_mode=crop_mode,
                  core_alpha=core_alpha, suspect_edges=[], status="ok")
    if raw is None:
        result["status"] = "empty"
        return result
    if crop_mode != "tight":
        result["status"] = "expected_padding"
        return result
    if core is None:
        result.update(status="review", reason="low_alpha_only")
        return result

    left, top, right, bottom = raw
    cl, ct, cr, cb = core
    bands = [
        ("left", cl-left, (left, top, cl, bottom)),
        ("top", ct-top, (left, top, right, ct)),
        ("right", right-cr, (cr, top, right, bottom)),
        ("bottom", bottom-cb, (left, cb, right, bottom)),
    ]
    for side, extension, box in bands:
        if extension < min_extension:
            continue
        histogram = alpha.crop(box).histogram()
        occupied = sum(histogram[1:])
        density = occupied / ((box[2]-box[0]) * (box[3]-box[1]))
        if occupied and density <= max_density:
            result["suspect_edges"].append(dict(
                side=side, extension_px=extension, band_box=list(box),
                nonzero_pixels=occupied, density=density,
                max_alpha=max(i for i, count in enumerate(histogram) if count),
            ))
    if result["suspect_edges"]:
        result.update(status="review", reason="sparse_low_alpha_tail")
    return result


def audit_image(path: Path, crop_mode: str = "tight", **thresholds) -> dict:
    with Image.open(path) as image:
        alpha = image.convert("RGBA").getchannel("A")
        return dict(file=str(path.resolve()), size=list(image.size),
                    **inspect_alpha(alpha, crop_mode, **thresholds))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, epilog=(
        "Exit 0: no suspect tails; 1: visual review needed; 2: empty image. "
        "Core alpha is diagnostic, not a threshold for deleting pixels."))
    parser.add_argument("path", type=Path, help="PNG or directory of PNG files")
    parser.add_argument("--manifest", type=Path, help="Read asset crop_mode from the slice manifest")
    parser.add_argument("--output", type=Path, help="Save the JSON report outside the delivery folder")
    parser.add_argument("--core-alpha", type=int, default=32)
    parser.add_argument("--min-extension", type=int, default=8)
    parser.add_argument("--max-density", type=float, default=0.02)
    args = parser.parse_args(argv)
    paths = sorted(args.path.glob("*.png")) if args.path.is_dir() else [args.path]
    if not paths or any(not p.is_file() for p in paths):
        parser.error("No PNG files found")
    modes = {}
    if args.manifest:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
        modes = {a["filename"]: a.get("crop_mode", "tight") for a in manifest["assets"]}
    try:
        images = [audit_image(p, modes.get(p.name, "tight"), core_alpha=args.core_alpha,
                              min_extension=args.min_extension, max_density=args.max_density)
                  for p in paths]
    except ValueError as error:
        parser.error(str(error))
    report = dict(image_count=len(images), review_count=sum(i["status"] == "review" for i in images),
                  empty_count=sum(i["status"] == "empty" for i in images), images=images)
    encoded = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded)
    return 2 if report["empty_count"] else 1 if report["review_count"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
