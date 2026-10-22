#!/usr/bin/env python3
"""只读汇总 Spine 3.8 导出 JSON；不解析 .spine，不采样或修改动画。"""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys


ANIMATION_CATEGORIES = {
    "bones", "slots", "deform", "ik", "transform", "paths", "events", "drawOrder"
}
BONE_CHANNELS = {
    "rotate": ("angle",), "translate": ("x", "y"),
    "scale": ("x", "y"), "shear": ("x", "y"),
}


def timelines(value, path=()):
    """Stop at frame arrays; FFD vertex arrays are payloads, not more keyframes."""
    if isinstance(value, dict):
        for key, child in value.items():
            yield from timelines(child, path + (key,))
    elif isinstance(value, list) and value:
        if not all(isinstance(frame, dict) for frame in value):
            raise ValueError(f"非标准时间轴：{path}")
        yield path, value


def bone_endpoint_differences(tracks, duration):
    result = []
    for path, frames in tracks:
        if len(path) != 3 or path[0] != "bones" or path[2] not in BONE_CHANNELS:
            continue
        first, last = frames[0], frames[-1]
        if len(frames) < 2 or abs(first.get("time", 0)) > 0.0002:
            continue
        if abs(last.get("time", 0) - duration) > 0.0002:
            continue
        default = 1 if path[2] == "scale" else 0
        fields = BONE_CHANNELS[path[2]]
        start = {key: first.get(key, default) for key in fields}
        end = {key: last.get(key, default) for key in fields}
        if any(abs(start[key] - end[key]) > 0.0001 for key in fields):
            result.append({"timeline": list(path), "first": start, "last": end})
    return result


def animation_summary(animation, detailed=False):
    unknown = set(animation) - ANIMATION_CATEGORIES
    if unknown:
        raise ValueError(f"未知动画字段，不静默忽略：{sorted(unknown)}")
    tracks = list(timelines(animation))
    times = [frame.get("time", 0) for _, frames in tracks for frame in frames]
    duration = max(times, default=0)
    counts = Counter()
    curves = Counter()
    for path, frames in tracks:
        counts[path[0]] += len(frames)
        if path[0] in {"slots", "events", "drawOrder"}:
            continue
        for frame in frames:
            curve = frame.get("curve", "linear")
            kind = curve if isinstance(curve, str) else "bezier"
            curves[kind] += 1
    result = {
        "duration_seconds": duration,
        "keyframes": len(times),
        "keyframes_by_category": dict(counts),
        "continuous_track_curves": dict(curves),
        "frames_off_30fps_grid": sum(abs(t * 30 - round(t * 30)) > 0.002 for t in times),
        "deform_targets": [list(path[1:]) for path, _ in tracks if path[0] == "deform"],
    }
    if detailed:
        result["slot_timelines"] = animation.get("slots", {})
        result["draw_order"] = animation.get("drawOrder", [])
        result["bone_endpoint_differences"] = bone_endpoint_differences(tracks, duration)
        result["endpoint_note"] = (
            "只比较同时在 0 和动画终点有帧的骨骼数值，补齐省略的默认值；"
            "不求插值、角度等价、世界姿势、FFD、IK 或循环状态。"
        )
    return result


def inspect(data, raw, animation_name=None):
    if not isinstance(data, dict):
        raise ValueError("输入必须是骨架 JSON 对象")
    version = data.get("skeleton", {}).get("spine", "")
    if not isinstance(version, str) or not version.startswith("3.8."):
        raise ValueError(f"此脚本只汇总 Spine 3.8.x 导出 JSON，实际版本：{version!r}")
    bones, slots, skins = data.get("bones", []), data.get("slots", []), data.get("skins", [])
    animations = data.get("animations", {})
    if not all(isinstance(x, list) for x in (bones, slots, skins)) or not isinstance(animations, dict):
        raise ValueError("bones/slots/skins 应为数组，animations 应为对象")
    if animation_name is not None and animation_name not in animations:
        raise ValueError(f"动画不存在：{animation_name}；可用：{', '.join(animations)}")
    attachments, alternatives, mesh_counts = [], [], Counter()
    for skin in skins:
        for slot, values in skin.get("attachments", {}).items():
            if len(values) > 1:
                alternatives.append({"skin": skin["name"], "slot": slot, "attachments": list(values)})
            for name, attachment in values.items():
                kind = attachment.get("type", "region")
                record = {"skin": skin["name"], "slot": slot, "name": name, "type": kind}
                if attachment.get("path") is not None:
                    record["texture_path"] = attachment["path"]
                if kind == "mesh":
                    if attachment.get("parent"):
                        mesh_counts["linked"] += 1
                    else:
                        uv_count = len(attachment.get("uvs", []))
                        if not uv_count or uv_count % 2:
                            raise ValueError(f"网格 UV 缺失或数量异常：{slot}/{name}")
                        weighted = len(attachment.get("vertices", [])) != uv_count
                        mesh_counts["weighted" if weighted else "unweighted"] += 1
                        record.update(logical_vertices=uv_count // 2, weighted=weighted)
                elif kind == "linkedmesh":
                    mesh_counts["linked"] += 1
                attachments.append(record)
    constraints = {key: data.get(key, []) for key in ("ik", "transform", "path")}
    selected = animations.items() if animation_name is None else [(animation_name, animations[animation_name])]
    return {
        "source_json_sha256": hashlib.sha256(raw).hexdigest(),
        "skeleton": data.get("skeleton", {}),
        "counts": {
            "bones": len(bones), "slots": len(slots), "skins": len(skins),
            "attachments": len(attachments), "animations": len(animations),
            "constraints": sum(len(value) for value in constraints.values()),
            "events": len(data.get("events", {})),
        },
        "attachment_types": dict(Counter(a["type"] for a in attachments)),
        "mesh_counts": dict(mesh_counts),
        "constraints": constraints,
        "slot_bindings": slots,
        "alternate_attachments": alternatives,
        "meshes": [a for a in attachments if a["type"] in {"mesh", "linkedmesh"}],
        "animations": {name: animation_summary(value, animation_name is not None) for name, value in selected},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("json_path", type=Path, help="spine_export_animation 导出的骨架 JSON")
    parser.add_argument("--animation", help="限定动画并加入换图、绘制顺序和骨骼端点差异")
    parser.add_argument("--output", type=Path, help="写入汇总 JSON；省略则打印到标准输出")
    args = parser.parse_args()
    try:
        if args.json_path.suffix.lower() != ".json":
            raise ValueError("输入必须是导出 .json，不是二进制 .spine/.skel")
        if args.output and args.output.resolve() == args.json_path.resolve():
            raise ValueError("输出不能覆盖输入快照")
        raw = args.json_path.read_bytes()
        data = json.loads(raw.decode("utf-8-sig"))
        result = inspect(data, raw, args.animation)
        output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(output, encoding="utf-8")
            print(f"已写入汇总：{args.output.resolve()}")
        else:
            print(output, end="")
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        print(f"检查失败：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
