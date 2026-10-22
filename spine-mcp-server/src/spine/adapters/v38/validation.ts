import { readSkeletonData, getCoreRuntime } from "./runtime";
import { ErrorCode, SpineError } from "../../../utils/error-codes";
import { validateJsonReferences } from "../../validate-service";

/** 使用同版 runtime 规范化默认值、FFD offset 和稀疏时间轴，无需 canvas/贴图。 */
export function skeletonSnapshot(json: any): any {
  const s = getCoreRuntime();
  const data = readSkeletonData(json);
  const plain = (v: any): any => {
    if (v === undefined) return null;
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("数据中出现非有限数值");
    if (ArrayBuffer.isView(v) || Array.isArray(v)) return Array.from(v as any, plain);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, plain(v[k])]));
    return v;
  };
  const pick = (v: any, keys: string[]) => Object.fromEntries(keys.map(k => [k, plain(v[k])]));
  const ref = (v: any) => v?.name ?? null;
  const angle = (v: number) => ((v + 180) % 360 + 360) % 360 - 180;
  // Spine 导入时可能按骨骼序号重排每个顶点的权重及其 FFD 分量。
  const reorderWeights = (attachment: any, values: ArrayLike<number>, stride: number): number[] => {
    if (!attachment.bones) return Array.from(values);
    const result: number[] = [];
    let index = 0, offset = 0, weightOffset = 0;
    while (index < attachment.bones.length) {
      const count = attachment.bones[index++];
      const group = Array.from({ length: count }, (_, i) => ({ bone: attachment.bones[index + i], i }))
        .filter(v => attachment.vertices[weightOffset + v.i * 3 + 2] !== 0);
      group.sort((a, b) => a.bone - b.bone);
      for (const item of group) for (let k = 0; k < stride; k++) result.push(values[offset + item.i * stride + k]);
      offset += count * stride; weightOffset += count * 3; index += count;
    }
    return result;
  };
  const attachmentData = (a: any) => {
    const result = pick(a, ["path", "x", "y", "rotation", "scaleX", "scaleY", "width", "height", "color", "bones", "vertices", "worldVerticesLength", "regionUVs", "triangles", "hullLength", "edges", "lengths", "closed", "constantSpeed"]);
    if (a.bones) {
      result.vertices = reorderWeights(a, a.vertices, 3);
      let i = 0, offset = 0; const bones: number[] = [];
      while (i < a.bones.length) {
        const count = a.bones[i++];
        const group = Array.from({ length: count }, (_, k) => ({ bone: a.bones[i + k], weight: a.vertices[offset + k * 3 + 2] })).filter(v => v.weight !== 0).map(v => v.bone).sort((x, y) => x - y);
        bones.push(group.length, ...group); i += count; offset += count * 3;
      }
      result.bones = bones;
    }
    const topology = (values: number[], size: number) => {
      const groups: number[][] = [];
      for (let i = 0; i < values.length; i += size) groups.push(Array.from(values.slice(i, i + size)).sort((x, y) => x - y));
      return groups.sort((x, y) => { for (let i = 0; i < size; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
    };
    if (a.triangles) result.triangles = topology(a.triangles, 3);
    // CLI 会为省略 edges 的网格补齐 hull 边界，视为同一拓扑。
    if (a.edges || a.hullLength) {
      const edges = a.edges ?? Array.from({ length: a.hullLength / 2 }, (_, i) => [i * 2, ((i + 1) % (a.hullLength / 2)) * 2]).flat();
      result.edges = topology(edges, 2);
    }
    return result;
  };
  const constraints = (list: any[]) => list.map(v => ({
    ...pick(v, ["name", "order", "skinRequired", "mix", "softness", "bendDirection", "compress", "stretch", "uniform", "rotateMix", "translateMix", "scaleMix", "shearMix", "offsetRotation", "offsetX", "offsetY", "offsetScaleX", "offsetScaleY", "offsetShearY", "local", "relative", "positionMode", "spacingMode", "rotateMode", "position", "spacing"]),
    bones: v.bones.map(ref), target: ref(v.target),
  }));
  return {
    images: ["", ".", "./"].includes(json.skeleton?.images ?? "") ? "" : json.skeleton.images, audio: json.skeleton?.audio ?? "",
    bones: data.bones.map((b: any) => ({ ...pick(b, ["name", "length", "x", "y", "rotation", "scaleX", "scaleY", "shearX", "shearY", "transformMode", "skinRequired", "color"]), parent: ref(b.parent) })),
    slots: data.slots.map((v: any) => ({ ...pick(v, ["name", "attachmentName", "blendMode", "color", "darkColor"]), bone: ref(v.boneData) })),
    skins: data.skins.map((skin: any) => ({ name: skin.name, bones: skin.bones.map(ref), constraints: skin.constraints.map(ref), attachments: skin.getAttachments().map((e: any) => ({
      slotIndex: e.slotIndex, name: e.name, type: e.attachment.constructor.name,
      ...attachmentData(e.attachment), endSlot: ref(e.attachment.endSlot),
    })).sort((a: any, b: any) => a.slotIndex - b.slotIndex || a.name.localeCompare(b.name)) })),
    ik: constraints(data.ikConstraints), transform: constraints(data.transformConstraints), path: constraints(data.pathConstraints),
    events: data.events.map((e: any) => pick(e, ["name", "intValue", "floatValue", "stringValue", "audioPath", "volume", "balance"])),
    animations: data.animations.map((a: any) => ({ name: a.name, duration: a.duration, timelines: a.timelines.map((t: any) => {
      const result: any = { type: t.constructor.name };
      for (const key of Object.keys(t).sort()) {
        if (key === "attachment") result.attachment = ref(t.attachment);
        else if (key === "curves") {
          const count = t.getFrameCount();
          const stride = t.constructor.ENTRIES ?? 1;
          result.curves = Array.from({ length: Math.max(0, count - 1) }, (_, i) => {
            const values = (frame: number): number[] => t.frameVertices
              ? reorderWeights(t.attachment, t.frameVertices[frame], 2)
              : Array.from({ length: stride - 1 }, (_, k) => t.frames[frame * stride + k + 1]);
            const from = values(i), to = values(i + 1);
            return [0.25, 0.5, 0.75].map(v => from.map((x, k) => t instanceof s.RotateTimeline
              ? angle(x + angle(to[k] - x) * t.getCurvePercent(i, v))
              : x + (to[k] - x) * t.getCurvePercent(i, v)));
          });
        }
        else if (key === "frames" && t instanceof s.RotateTimeline) result.frames = Array.from(t.frames as number[], (v, i) => i % 2 ? angle(v) : v);
        else if (key === "frameVertices" && t.attachment?.bones) result.frameVertices = t.frameVertices.map((v: any) => reorderWeights(t.attachment, v, 2));
        else if (key === "events") result.events = t.events.map((e: any) => ({ ...pick(e, ["time", "intValue", "floatValue", "stringValue", "volume", "balance"]), name: ref(e.data) }));
        else result[key] = plain(t[key]);
      }
      return result;
    }).sort((a: any, b: any) => `${a.type}:${a.boneIndex}:${a.slotIndex}:${a.ikConstraintIndex}:${a.transformConstraintIndex}:${a.pathConstraintIndex}:${a.attachment}`.localeCompare(`${b.type}:${b.boneIndex}:${b.slotIndex}:${b.ikConstraintIndex}:${b.transformConstraintIndex}:${b.pathConstraintIndex}:${b.attachment}`)) })).sort((a: any, b: any) => a.name.localeCompare(b.name)),
  };
}

export function validateRebuildJson(json: any): void {
  try {
    if (!json || typeof json !== "object" || !Array.isArray(json.bones) || !json.bones.length) throw new Error("需要含 bones 的 Spine 骨架 JSON");
    if (Object.keys(json).some(k => !["skeleton", "bones", "slots", "skins", "ik", "transform", "path", "events", "animations"].includes(k))) throw new Error("骨架 JSON 包含无法重建的未知顶层字段");
    const errors = validateJsonReferences(json);
    for (const key of ["bones", "slots", "ik", "transform", "path"]) {
      const names = (json[key] ?? []).map((v: any) => v.name);
      if (names.some((n: any) => typeof n !== "string" || !n) || new Set(names).size !== names.length) errors.push(`${key} 名称为空或重复`);
    }
    const numeric = (v: any): void => {
      if (typeof v === "number" && !Number.isFinite(v)) throw new Error("数据包含非有限数值");
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
        if (["__proto__", "constructor", "prototype"].includes(k)) throw new Error("不允许的属性名");
        numeric(x);
      }
    };
    numeric(json);
    const skins = Array.isArray(json.skins) ? json.skins : Object.entries(json.skins ?? {}).map(([name, attachments]) => ({ name, attachments }));
    const hasAttachment = (slot: string, name: string) => skins.some((skin: any) => Object.hasOwn(skin.attachments?.[slot] ?? {}, name));
    for (const slot of json.slots ?? []) if (slot.attachment && !hasAttachment(slot.name, slot.attachment)) throw new Error(`默认附件不存在：${slot.name}/${slot.attachment}`);
    for (const skin of skins) for (const atts of Object.values<any>(skin.attachments ?? {})) for (const [name, a] of Object.entries<any>(atts)) {
      if (a.type === "mesh" && !a.parent) {
        if (!Array.isArray(a.uvs) || a.uvs.length % 2 || !Array.isArray(a.vertices) || !Array.isArray(a.triangles)) throw new Error(`网格结构无效：${name}`);
        const count = a.uvs.length / 2;
        if (a.triangles.length % 3 || a.triangles.some((n: any) => !Number.isInteger(n) || n < 0 || n >= count)) throw new Error(`网格三角形索引无效：${name}`);
        if (a.vertices.length !== a.uvs.length) {
          let i = 0, vertices = 0;
          while (i < a.vertices.length) {
            const n = a.vertices[i++];
            if (!Number.isInteger(n) || n < 1 || n > json.bones.length || i + n * 4 > a.vertices.length) throw new Error(`网格权重布局无效：${name}`);
            let sum = 0;
            for (let k = 0; k < n; k++, i += 4) {
              if (!Number.isInteger(a.vertices[i]) || a.vertices[i] < 0 || a.vertices[i] >= json.bones.length || a.vertices[i + 3] < 0) throw new Error(`网格权重骨骼索引无效：${name}`);
              sum += a.vertices[i + 3];
            }
            if (Math.abs(sum - 1) > 0.001) throw new Error(`网格顶点权重和不为 1：${name}`);
            vertices++;
          }
          if (vertices !== count) throw new Error(`网格顶点数量不一致：${name}`);
        }
      }
    }
    const frameKeys = ["time", "curve", "c2", "c3", "c4"];
    const checkFrames = (frames: any, keys: string[], label: string): void => {
      if (!Array.isArray(frames)) throw new Error(`时间轴必须是数组：${label}`);
      let last = -1;
      for (const frame of frames) {
        if (!frame || Array.isArray(frame) || typeof frame !== "object" || !Number.isFinite(frame.time ?? 0) || (frame.time ?? 0) < 0 || (frame.time ?? 0) <= last) throw new Error(`关键帧时间重复、未排序或无效：${label}`);
        last = frame.time ?? 0;
        if (Object.keys(frame).some(k => ![...frameKeys, ...keys].includes(k))) throw new Error(`关键帧包含未知字段：${label}`);
      }
    };
    for (const [animName, anim] of Object.entries<any>(json.animations ?? {})) {
      if (Object.keys(anim).some(k => !["bones", "slots", "ik", "transform", "paths", "deform", "drawOrder", "events"].includes(k))) throw new Error(`动画包含未知字段：${animName}`);
      for (const [bone, timelines] of Object.entries<any>(anim.bones ?? {})) for (const [type, frames] of Object.entries(timelines)) {
        if (!["rotate", "translate", "scale", "shear"].includes(type)) throw new Error(`未知骨骼时间轴：${type}`);
        checkFrames(frames, type === "rotate" ? ["angle"] : ["x", "y"], `${animName}/${bone}/${type}`);
      }
      for (const [slot, timelines] of Object.entries<any>(anim.slots ?? {})) for (const [type, frames] of Object.entries(timelines)) {
        const keys: Record<string, string[]> = { attachment: ["name"], color: ["color"], twoColor: ["light", "dark"] };
        if (!keys[type]) throw new Error(`未知插槽时间轴：${type}`);
        checkFrames(frames, keys[type], `${animName}/${slot}/${type}`);
        if (type === "attachment") for (const frame of frames as any[]) if (frame.name && !hasAttachment(slot, frame.name)) throw new Error(`动画附件不存在：${animName}/${slot}/${frame.name}`);
      }
      for (const frames of Object.values(anim.ik ?? {})) checkFrames(frames, ["mix", "softness", "bendPositive", "compress", "stretch"], `${animName}/ik`);
      for (const frames of Object.values(anim.transform ?? {})) checkFrames(frames, ["rotateMix", "translateMix", "scaleMix", "shearMix"], `${animName}/transform`);
      for (const timelines of Object.values<any>(anim.paths ?? {})) for (const [type, frames] of Object.entries(timelines)) {
        if (!["position", "spacing", "mix"].includes(type)) throw new Error(`未知路径时间轴：${type}`);
        checkFrames(frames, ["position", "spacing", "rotateMix", "translateMix"], `${animName}/paths/${type}`);
      }
      for (const [skinName, slots] of Object.entries<any>(anim.deform ?? {})) for (const [slotName, atts] of Object.entries<any>(slots)) for (const [attachmentName, frames] of Object.entries<any>(atts)) {
        checkFrames(frames, ["offset", "vertices"], `${animName}/deform`);
        const attachment = skins.find((skin: any) => skin.name === skinName)?.attachments?.[slotName]?.[attachmentName];
        if (!attachment) throw new Error(`形变附件不存在：${skinName}/${slotName}/${attachmentName}`);
        if (attachment.type === "mesh" && !attachment.parent) {
          let length = attachment.vertices.length;
          if (length !== attachment.uvs.length) { length = 0; for (let i = 0; i < attachment.vertices.length;) { const n = attachment.vertices[i]; length += n * 2; i += 1 + n * 4; } }
          for (const frame of frames) if (!Number.isInteger(frame.offset ?? 0) || (frame.offset ?? 0) < 0 ||
            (frame.vertices !== undefined && (!Array.isArray(frame.vertices) || (frame.offset ?? 0) + frame.vertices.length > length))) throw new Error(`形变顶点数量或 offset 无效：${attachmentName}`);
        }
      }
      if (anim.drawOrder) checkFrames(anim.drawOrder, ["offsets"], `${animName}/drawOrder`);
      // 同时刻的多个事件合法，不采用普通时间轴的唯一时间限制。
      if (anim.events) for (const f of anim.events) checkFrames([f], ["name", "int", "float", "string", "volume", "balance"], `${animName}/events`);
    }
    if (errors.length) throw new Error(errors.join("；"));
    skeletonSnapshot(json);
  } catch (e: any) { throw new SpineError(ErrorCode.REBUILD_VALIDATION, `骨架数据校验失败：${e.message}`); }
}

/** 比较导入前后实际运行数据；允许 JSON 浮点精度舍入，不允许对象/帧/网格丢失。 */
export function verifyRebuiltSkeleton(expected: any, actual: any): void {
  const differences: string[] = [];
  const compare = (a: any, b: any, p: string): void => {
    if (differences.length >= 8) return;
    if (typeof a === "number" && typeof b === "number") {
      if (Math.abs(a - b) > 0.021 + 0.00002 * Math.max(Math.abs(a), Math.abs(b))) differences.push(p);
    } else if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) differences.push(`${p}.length (${a.length} → ${b.length})`);
      else a.forEach((v, i) => compare(v, b[i], `${p}[${i}]`));
    } else if (a && b && typeof a === "object" && typeof b === "object") {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) compare(a[k], b[k], `${p}.${k}`);
    } else if (a !== b) differences.push(p);
  };
  compare(skeletonSnapshot(expected), skeletonSnapshot(actual), "skeleton");
  if (differences.length) throw new SpineError(ErrorCode.REBUILD_VALIDATION,
    `重建回读与预期不一致，原工程未替换：${differences.join("；")}`);
}
