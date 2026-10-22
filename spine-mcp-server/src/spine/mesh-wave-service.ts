import { MeshTarget, deformMesh, meshInfo, selectedVertices, inversePoint, worldVertices, failEdit } from "./mesh-edit-service";
import { readSkeletonData, sampleSkeleton } from "./runtime-core";

export interface WaveOptions {
  animationName?: string; duration?: number; amplitude?: number; wavelength?: number; cycles?: number;
  axis?: "x" | "y"; phase?: number; fps?: number; skinName?: string;
  mode?: "create" | "add" | "replace"; vertexIndices?: number[]; pinnedVertices?: number[];
}
export interface WaveResult { animationName: string; slotName: string; attachmentName: string; vertexCount: number; keyframes: number; weighted: boolean; }

/** 普通/加权网格共用逻辑顶点坐标，既可独立创建也可叠加到已有动画。 */
export function meshWave(json: any, slotName: string, attachmentName: string, options: WaveOptions = {}): WaveResult {
  const target: MeshTarget = { slotName, attachmentName, skinName: options.skinName };
  const info = meshInfo(json, target), mode = options.mode ?? "create";
  const duration = options.duration ?? 1.5, fps = options.fps ?? 12;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 30) failEdit("duration 需要在 0..30 秒之间");
  let name = options.animationName ?? `${attachmentName}-wave`;
  if (mode === "create") {
    const base = name; let suffix = 1;
    while (json.animations?.[name]) name = `${base}-${suffix++}`;
    json.animations ??= {}; json.animations[name] = {};
  } else if (!json.animations?.[name]) failEdit(`动画不存在：${name}`);
  const selection = new Set(selectedVertices(info.vertices.length, options.vertexIndices));
  for (const pin of options.pinnedVertices ?? []) { selectedVertices(info.vertices.length, [pin]); selection.delete(pin); }
  const setup = sampleSkeleton(readSkeletonData(json), undefined, 0, options.skinName), world = worldVertices(setup, target);
  const slot = setup.findSlot(slotName), local = info.vertices.map((_, i) => inversePoint(slot.bone, world[i * 2], world[i * 2 + 1]));
  const count = Math.max(2, Math.round(duration * fps)), frames = [];
  for (let i = 0; i <= count; i++) {
    const offsets: number[] = [], time = duration * i / count;
    for (let vertex = 0; vertex < local.length; vertex++) {
      const along = local[vertex][options.axis === "x" ? 1 : 0];
      const wave = selection.has(vertex) ? (options.amplitude ?? 6) * Math.sin(Math.PI * 2 * (along / (options.wavelength ?? 48) - (options.cycles ?? 1) * time / duration) + (options.phase ?? 0)) : 0;
      offsets.push(options.axis === "x" ? wave : 0, options.axis === "x" ? 0 : wave);
    }
    frames.push({ time, offsets });
  }
  deformMesh(json, target, { animationName: name, frames, space: "slot", mode: mode === "add" ? "add" : "replace" });
  return { animationName: name, slotName, attachmentName, vertexCount: info.vertices.length, keyframes: frames.length, weighted: info.weighted };
}
