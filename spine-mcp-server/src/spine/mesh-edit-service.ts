import { ErrorCode, SpineError } from "../utils/error-codes";
import { readSkeletonData, sampleSkeleton } from "./runtime-core";
import { adapterForJson } from "./project-context";

export const failEdit = (message: string): never => { throw new SpineError(ErrorCode.INVALID_ARGUMENT, message); };
export function safeName(name: string): void {
  if (!name || ["__proto__", "prototype", "constructor"].includes(name)) failEdit("名称为空或无效");
}
export interface MeshTarget { slotName: string; attachmentName: string; skinName?: string; }
export interface Influence { bone: number; x: number; y: number; weight: number; }
export function findAttachment(json: any, target: MeshTarget): any {
  for (const n of [target.skinName ?? "default", target.slotName, target.attachmentName]) safeName(n);
  const skins = Array.isArray(json.skins) ? json.skins : Object.entries(json.skins ?? {}).map(([name, attachments]) => ({ name, attachments }));
  const skin = skins.find((s: any) => s.name === (target.skinName ?? "default"));
  const attachment = skin?.attachments?.[target.slotName]?.[target.attachmentName];
  if (!attachment) failEdit(`附件不存在：${target.skinName ?? "default"}/${target.slotName}/${target.attachmentName}`);
  return attachment;
}
export function meshInfo(json: any, target: MeshTarget): { attachment: any; weighted: boolean; vertices: Influence[][]; slot: any } {
  const attachment = findAttachment(json, target), slot = json.slots?.find((s: any) => s.name === target.slotName);
  if (!slot || attachment.type !== "mesh" || attachment.parent) failEdit("需要独立 mesh 附件；关联网格请编辑其源网格");
  const v = attachment.vertices, count = attachment.uvs?.length / 2;
  if (!Array.isArray(v) || !Number.isInteger(count) || count < 1) failEdit("网格顶点数据无效");
  const weighted = v.length !== attachment.uvs.length, vertices: Influence[][] = [];
  if (!weighted) {
    const bone = json.bones.findIndex((b: any) => b.name === slot.bone);
    for (let i = 0; i < v.length; i += 2) vertices.push([{ bone, x: v[i], y: v[i + 1], weight: 1 }]);
  } else {
    for (let i = 0; i < v.length;) {
      const n = v[i++], influences: Influence[] = [];
      if (!Number.isInteger(n) || n < 1 || i + n * 4 > v.length) failEdit("权重布局无效");
      for (let k = 0; k < n; k++, i += 4) {
        if (!json.bones[v[i]] || !Number.isFinite(v[i + 3]) || v[i + 3] < 0) failEdit("权重或骨骼索引无效");
        influences.push({ bone: v[i], x: v[i + 1], y: v[i + 2], weight: v[i + 3] });
      }
      vertices.push(influences);
    }
    if (vertices.length !== count) failEdit("顶点数量与权重数量不一致");
  }
  return { attachment, weighted, vertices, slot };
}
export function selectedVertices(count: number, indices?: number[]): number[] {
  const result = indices ?? Array.from({ length: count }, (_, i) => i);
  if (!result.length || new Set(result).size !== result.length || result.some(i => !Number.isInteger(i) || i < 0 || i >= count)) failEdit("顶点选择为空、重复或越界");
  return result;
}
export function meshSlot(sk: any, target: MeshTarget): any {
  const slot = sk.findSlot(target.slotName);
  const attachment = sk.data.findSkin(target.skinName ?? "default")?.getAttachment(slot?.data.index, target.attachmentName);
  if (!slot || !attachment?.computeWorldVertices) failEdit("runtime 无法定位网格");
  if (slot.attachment !== attachment) slot.setAttachment(attachment);
  return slot;
}
export function worldVertices(sk: any, target: MeshTarget): number[] {
  const slot = meshSlot(sk, target), out = new Float32Array(slot.attachment.worldVerticesLength);
  slot.attachment.computeWorldVertices(slot, 0, out.length, out, 0, 2);
  return Array.from(out);
}
export function inverseVector(bone: any, x: number, y: number): [number, number] {
  const det = bone.a * bone.d - bone.b * bone.c;
  if (Math.abs(det) < 1e-8) return failEdit(`骨骼变换不可逆：${bone.data.name}`);
  return [(bone.d * x - bone.b * y) / det, (bone.a * y - bone.c * x) / det];
}
export function inversePoint(bone: any, x: number, y: number): [number, number] { return inverseVector(bone, x - bone.worldX, y - bone.worldY); }

/** 用户提供的是每个逻辑顶点的世界位移；加权网格自动展开为每项骨骼影响的局部 FFD。 */
export function offsetsToDeform(info: ReturnType<typeof meshInfo>, sk: any, offsets: number[]): number[] {
  if (offsets.length !== info.vertices.length * 2 || offsets.some(v => !Number.isFinite(v))) return failEdit("offsets 必须为每个顶点一对有限坐标");
  const out: number[] = [];
  for (let i = 0; i < info.vertices.length; i++) {
    const influences = info.vertices[i], sum = influences.reduce((s, v) => s + v.weight, 0);
    if (sum <= 0) failEdit("顶点总权重必须大于 0");
    for (const influence of influences) out.push(...inverseVector(sk.bones[influence.bone], offsets[i * 2] / sum, offsets[i * 2 + 1] / sum));
  }
  return out.map(v => Math.abs(v) < 1e-8 ? 0 : Number(v.toFixed(6)));
}
export function inspectMesh(json: any, target: MeshTarget, animationName?: string, time = 0): any {
  const info = meshInfo(json, target), sk = sampleSkeleton(readSkeletonData(json), animationName, time, target.skinName);
  const positions = worldVertices(sk, target);
  return { ...target, skinName: target.skinName ?? "default", weighted: info.weighted, vertexCount: info.vertices.length,
    uvs: info.attachment.uvs, triangles: info.attachment.triangles, hull: info.attachment.hull,
    vertices: info.vertices.map((influences, i) => ({ index: i, worldX: positions[i * 2], worldY: positions[i * 2 + 1],
      influences: influences.map(v => ({ ...v, boneName: json.bones[v.bone].name })) })) };
}

export function deformMesh(json: any, target: MeshTarget, options: { animationName: string; frames: { time: number; offsets: number[] }[];
  space?: "world" | "slot"; mode?: "replace" | "add" }): any {
  const info = meshInfo(json, target), animation = json.animations?.[options.animationName];
  if (!animation) failEdit(`动画不存在：${options.animationName}`);
  const data = readSkeletonData(json), skin = target.skinName ?? "default";
  const timelinePath = adapterForJson(json, "mesh.deform").json.deformPath(skin, target.slotName, target.attachmentName);
  const old = timelinePath.reduce((value, key) => value?.[key], animation) ?? [];
  const frames = structuredClone(old);
  for (const frame of options.frames) {
    if (!Number.isFinite(frame.time) || frame.time < 0) failEdit("time 必须为非负秒数");
    const sk = sampleSkeleton(data, options.animationName, frame.time, skin), slot = meshSlot(sk, target);
    let offsets = frame.offsets.slice();
    if (options.space === "slot") for (let i = 0; i < offsets.length; i += 2) {
      const x = offsets[i], y = offsets[i + 1]; offsets[i] = slot.bone.a * x + slot.bone.b * y; offsets[i + 1] = slot.bone.c * x + slot.bone.d * y;
    }
    let values = offsetsToDeform(info, sk, offsets);
    if (options.mode === "add" && slot.deform.length) values = values.map((v, i) => v + slot.deform[i] - (info.weighted ? 0 : info.attachment.vertices[i]));
    const index = frames.findIndex((f: any) => Math.abs((f.time ?? 0) - frame.time) < 1e-6);
    const next = { time: frame.time, vertices: values };
    if (index < 0) frames.push(next); else frames[index] = next;
  }
  frames.sort((a: any, b: any) => (a.time ?? 0) - (b.time ?? 0));
  let parent = animation;
  for (const key of timelinePath.slice(0, -1)) parent = parent[key] ??= {};
  parent[timelinePath[timelinePath.length - 1]] = frames;
  return { vertexCount: info.vertices.length, frames: options.frames.length, weighted: info.weighted };
}

export function meshRebindTracks(json: any, target: MeshTarget, deformPolicy = "reject"): any[] {
  const frames: any[] = [];
  for (const animation of Object.values<any>(json.animations ?? {})) {
    const atts = animation.deform?.[target.skinName ?? "default"]?.[target.slotName];
    if (atts?.[target.attachmentName]?.length) frames.push(atts);
  }
  // 改变影响数量会改变 FFD 数组布局，不能静默复用旧数据。
  if (frames.length && deformPolicy !== "clear") failEdit("此网格已有 FFD，修改权重或拓扑需显式 deformPolicy=clear（清除该附件所有动画形变）");
  for (const skin of Array.isArray(json.skins) ? json.skins : []) for (const atts of Object.values<any>(skin.attachments ?? {}))
    for (const a of Object.values<any>(atts)) if (a.parent === target.attachmentName && (a.skin ?? skin.name) === (target.skinName ?? "default")) failEdit("网格存在关联网格，需先解除关联再修改权重");
  return frames;
}

export function editWeights(json: any, target: MeshTarget, options: { action: "set" | "normalize" | "prune" | "smooth";
  vertexIndices?: number[]; influences?: { boneName: string; weight: number }[]; threshold?: number; strength?: number;
  deformPolicy?: "reject" | "clear" }): any {
  const info = meshInfo(json, target), selection = selectedVertices(info.vertices.length, options.vertexIndices);
  const frames = meshRebindTracks(json, target, options.deformPolicy);
  const sk = sampleSkeleton(readSkeletonData(json), undefined, 0, target.skinName), positions = worldVertices(sk, target);
  const weights = info.vertices.map(influences => {
    const values = new Map<number, number>();
    for (const i of influences) values.set(i.bone, (values.get(i.bone) ?? 0) + i.weight);
    return values;
  });
  const originalWeights = weights.map(v => new Map(v));
  const neighbors = info.vertices.map(() => new Set<number>());
  for (let i = 0; i < info.attachment.triangles.length; i += 3) for (const a of info.attachment.triangles.slice(i, i + 3))
    for (const b of info.attachment.triangles.slice(i, i + 3)) if (a !== b) neighbors[a].add(b);
  for (const index of selection) {
    let result = new Map(weights[index]);
    if (options.action === "set") {
      if (!options.influences?.length) failEdit("set 需要 influences");
      result = new Map();
      for (const v of options.influences!) {
        const bone = json.bones.findIndex((b: any) => b.name === v.boneName);
        if (bone < 0 || !Number.isFinite(v.weight) || v.weight < 0 || result.has(bone)) failEdit("骨骼不存在、重复或权重无效");
        result.set(bone, v.weight);
      }
    } else if (options.action === "prune") {
      const threshold = options.threshold ?? 0.01;
      const kept = [...result].filter(([, w]) => w >= threshold);
      result = new Map(kept.length ? kept : [[...result].sort((a, b) => b[1] - a[1])[0]]);
    } else if (options.action === "smooth" && neighbors[index].size) {
      const strength = options.strength ?? 0.5, average = new Map<number, number>();
      for (const neighbor of neighbors[index]) for (const [bone, w] of originalWeights[neighbor]) average.set(bone, (average.get(bone) ?? 0) + w / neighbors[index].size);
      result = new Map([...new Set([...result.keys(), ...average.keys()])].map(bone => [bone, (result.get(bone) ?? 0) * (1 - strength) + (average.get(bone) ?? 0) * strength]));
    }
    const sum = [...result.values()].reduce((a, b) => a + b, 0);
    if (sum <= 0) failEdit("顶点至少需要一个非零权重");
    weights[index] = new Map([...result].filter(([, w]) => w > 1e-8).map(([bone, w]) => [bone, w / sum]));
  }
  const encoded: number[] = [];
  const selected = new Set(selection);
  for (let index = 0; index < weights.length; index++) {
    if (!selected.has(index)) {
      encoded.push(info.vertices[index].length);
      for (const v of info.vertices[index]) encoded.push(v.bone, v.x, v.y, v.weight);
      continue;
    }
    const entries = [...weights[index]].sort((a, b) => a[0] - b[0]); encoded.push(entries.length);
    const unchanged = entries.length === info.vertices[index].length && entries.every(([bone, weight]) =>
      info.vertices[index].some(v => v.bone === bone && Math.abs(v.weight - weight) < 1e-10));
    for (const [bone, weight] of entries) {
      // 每项绑定坐标都指向同一 setup 世界点，权重修改后 setup 外形保持不变。
      const original = info.vertices[index].find(v => v.bone === bone)!;
      const point = unchanged ? [original.x, original.y] : inversePoint(sk.bones[bone], positions[index * 2], positions[index * 2 + 1]);
      encoded.push(bone, point[0], point[1], weight);
    }
  }
  info.attachment.vertices = encoded;
  for (const atts of frames) delete atts[target.attachmentName];
  return { affectedVertices: selection.length, clearedDeformAnimations: frames.length, vertexCount: info.vertices.length };
}
