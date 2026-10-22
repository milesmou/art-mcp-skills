import { animationDuration } from "./animation-utils";
import { MeshTarget, meshInfo, meshSlot, worldVertices, inversePoint, offsetsToDeform, failEdit } from "./mesh-edit-service";
import { readSkeletonData, sampleSkeleton } from "./runtime-core";

export interface ClothTarget extends MeshTarget {
  vertexWeights?: number[]; pinnedVertices?: number[]; gradientAxis?: "x" | "y"; freeEdge?: "min" | "max";
}
export interface ClothOptions {
  animationName: string; duration?: number; fps?: number; loop?: boolean;
  frequency?: number; damping?: number; strength?: number; maxOffset?: number; replaceExisting?: boolean;
}
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** 将跟随、滞后和回弹烘焙成普通 FFD，无需 canvas 或运行时物理系统。 */
export function clothMotion(json: any, targets: ClothTarget[], options: ClothOptions): any {
  const animation = json.animations?.[options.animationName];
  if (!animation) failEdit(`动画不存在：${options.animationName}`);
  const duration = options.duration ?? animationDuration(animation), fps = options.fps ?? 30;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 30) failEdit("布料时长需要在 0 到 30 秒之间");
  if (!targets.length || new Set(targets.map(t => `${t.skinName ?? "default"}/${t.slotName}/${t.attachmentName}`)).size !== targets.length) failEdit("网格目标为空或重复");
  const data = readSkeletonData(json), steps = Math.ceil(duration * 120), dt = duration / steps;
  const meta = targets.map(target => {
    const info = meshInfo(json, target), skin = target.skinName ?? "default";
    if (animation.deform?.[skin]?.[target.slotName]?.[target.attachmentName]?.length && !options.replaceExisting) failEdit(`已有形变：${target.slotName}；替换需 replaceExisting=true`);
    const setup = sampleSkeleton(data, undefined, 0, skin), slot = meshSlot(setup, target), positions = worldVertices(setup, target);
    const local = info.vertices.map((_, i) => inversePoint(slot.bone, positions[i * 2], positions[i * 2 + 1]));
    let mask = target.vertexWeights?.slice();
    if (mask && (mask.length !== local.length || mask.some(v => !Number.isFinite(v) || v < 0 || v > 1))) failEdit("vertexWeights 需要为每个顶点提供 0..1 的柔软程度");
    if (!mask) {
      const values = local.map(p => p[target.gradientAxis === "x" ? 0 : 1]), min = Math.min(...values), max = Math.max(...values);
      if (max - min < 1e-6) failEdit("自动渐变轴没有跨度，请提供 vertexWeights");
      mask = values.map(v => smooth(((target.freeEdge === "max" ? v - min : max - v) / (max - min) - 0.2) / 0.8));
    }
    for (const index of target.pinnedVertices ?? []) {
      if (!Number.isInteger(index) || index < 0 || index >= mask.length) failEdit("固定顶点索引越界");
      mask[index] = 0;
    }
    return { target, info, mask, skin };
  });
  if (meta.reduce((n, m) => n + m.info.vertices.length, 0) * steps > 2000000) failEdit("采样顶点过多，请缩短时长或分批处理");
  const samples: number[][][] = Array.from({ length: steps + 1 }, (_, i) => meta.map(m => worldVertices(sampleSkeleton(data, options.animationName, i * dt, m.skin), m.target)));
  const loop = options.loop ?? true;
  if (loop) for (let n = 0; n < meta.length; n++) {
    const delta = Math.max(...samples[0][n].map((v, k) => Math.abs(v - samples[steps][n][k])));
    if (delta > 0.05) failEdit(`源动画未闭环：${meta[n].target.slotName} 首尾差 ${delta.toFixed(3)}；可用 loop=false 生成非循环效果`);
  }
  const positions = samples[0].map(v => v.slice()), velocities = samples[0].map(v => v.map(() => 0));
  const frequency = options.frequency ?? 3.2, damping = options.damping ?? 0.75, omega = 2 * Math.PI * frequency;
  const lag: number[][][] = [], cycles = loop ? Math.max(8, Math.ceil(8 / (duration * frequency * damping))) : 1;
  if (cycles * steps > 200000) failEdit("布料收敛采样过多，请增加时长、frequency 或 damping");
  let start: number[][] = [], periodicError = 0;
  for (let cycle = 0; cycle < cycles; cycle++) for (let frame = 0; frame <= steps; frame++) {
    if (cycle === cycles - 1) {
      if (frame === 0) start = positions.map(v => v.slice());
      lag[frame] = positions.map((v, n) => v.map((p, k) => p - samples[frame][n][k]));
    }
    if (frame === steps) continue;
    for (let n = 0; n < meta.length; n++) for (let k = 0; k < positions[n].length; k++) {
      velocities[n][k] += ((samples[frame + 1][n][k] - positions[n][k]) * omega * omega - 2 * damping * omega * velocities[n][k]) * dt;
      positions[n][k] += velocities[n][k] * dt;
    }
  }
  if (loop) {
    for (let n = 0; n < meta.length; n++) for (let k = 0; k < positions[n].length; k++) periodicError = Math.max(periodicError, Math.abs(positions[n][k] - start[n][k]));
    if (periodicError > 0.01) failEdit("布料模拟尚未收敛，请增大 damping 或 frequency");
    lag[steps] = lag[0].map(v => v.slice());
  }
  const keyframes = Math.ceil(duration * fps), tracks: any[][] = meta.map(() => []), maximum = options.maxOffset ?? 10;
  let maxWorldOffset = 0, minAreaRatio = Infinity, triangleFlips = 0;
  for (let frame = 0; frame <= keyframes; frame++) {
    const time = frame / keyframes * duration, at = Math.min(steps, time / dt), index = Math.min(steps - 1, Math.floor(at)), alpha = at - index;
    for (let n = 0; n < meta.length; n++) {
      const m = meta[n], offsets: number[] = [], sk = sampleSkeleton(data, options.animationName, time, m.skin), before = worldVertices(sk, m.target);
      for (let vertex = 0; vertex < m.info.vertices.length; vertex++) {
        let x = (lag[index][n][vertex * 2] * (1 - alpha) + lag[index + 1][n][vertex * 2] * alpha) * (options.strength ?? 0.9);
        let y = (lag[index][n][vertex * 2 + 1] * (1 - alpha) + lag[index + 1][n][vertex * 2 + 1] * alpha) * (options.strength ?? 0.9);
        const length = Math.hypot(x, y), scale = length ? maximum * Math.tanh(length / maximum) / length * m.mask[vertex] : 0;
        x *= scale; y *= scale; offsets.push(x, y); maxWorldOffset = Math.max(maxWorldOffset, Math.hypot(x, y));
      }
      const values = offsetsToDeform(m.info, sk, offsets), slot = meshSlot(sk, m.target);
      const composed = values.map((v, i) => v + (slot.deform.length ? slot.deform[i] - (m.info.weighted ? 0 : m.info.attachment.vertices[i]) : 0));
      tracks[n].push({ time: Number(time.toFixed(6)), vertices: composed });
      const after = before.map((v, i) => v + offsets[i]);
      const area = (v: number[], a: number, b: number, c: number) => (v[b * 2] - v[a * 2]) * (v[c * 2 + 1] - v[a * 2 + 1]) - (v[c * 2] - v[a * 2]) * (v[b * 2 + 1] - v[a * 2 + 1]);
      for (let i = 0; i < m.info.attachment.triangles.length; i += 3) {
        const [a, b, c] = m.info.attachment.triangles.slice(i, i + 3), original = area(before, a, b, c), changed = area(after, a, b, c);
        if (Math.abs(original) > 2) { minAreaRatio = Math.min(minAreaRatio, changed / original); if (original * changed <= 0) triangleFlips++; }
      }
    }
  }
  if (triangleFlips || minAreaRatio < 0.2) failEdit("形变造成网格翻折或过度压缩，请减小 strength/maxOffset 或固定更多顶点");
  for (let n = 0; n < meta.length; n++) {
    const m = meta[n]; (((animation.deform ??= {})[m.skin] ??= {})[m.target.slotName] ??= {})[m.target.attachmentName] = tracks[n];
  }
  return { animationName: options.animationName, duration, keyframesPerMesh: keyframes + 1, meshes: meta.length,
    maxWorldOffset, minimumAreaRatio: Number.isFinite(minAreaRatio) ? minAreaRatio : null, triangleFlips, periodicError, loop };
}
