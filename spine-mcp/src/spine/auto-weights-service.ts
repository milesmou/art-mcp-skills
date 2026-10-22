import { failEdit, MeshTarget, meshInfo, meshRebindTracks, worldVertices, inversePoint } from "./mesh-edit-service";
import { readSkeletonData, sampleSkeleton } from "./runtime-core";
import { runWeightSolver } from "./external-tools";

export interface AutoWeightsOptions {
  bones: string[]; maxInfluences?: number; threshold?: number; deformPolicy?: "reject" | "clear";
  pins?: { vertexIndex: number; boneName: string }[];
}
export async function autoWeights(json: any, target: MeshTarget, options: AutoWeightsOptions): Promise<any> {
  const info = meshInfo(json, target), tracks = meshRebindTracks(json, target, options.deformPolicy);
  if (!options.bones.length || new Set(options.bones).size !== options.bones.length) failEdit("bones 必须非空且不能重复");
  if (info.vertices.length > 4096 || options.bones.length > Math.min(64, info.vertices.length)) failEdit("自动权重最多 4096 顶点、64 根骨骼，且骨骼数不能超过顶点数");
  const sk = sampleSkeleton(readSkeletonData(json), undefined, 0, target.skinName), positions = worldVertices(sk, target);
  const selected = options.bones.map(name => {
    const bone = sk.findBone(name); if (!bone) return failEdit(`骨骼不存在：${name}`);
    inversePoint(bone, 0, 0); // Reject singular bind matrices before invoking the solver.
    return bone;
  });
  const pins = (options.pins ?? []).map(pin => {
    const boneIndex = options.bones.indexOf(pin.boneName);
    if (boneIndex < 0 || !Number.isInteger(pin.vertexIndex) || pin.vertexIndex < 0 || pin.vertexIndex >= info.vertices.length) return failEdit("固定顶点或固定骨骼无效");
    return { vertexIndex: pin.vertexIndex, boneIndex };
  });
  if (new Set(pins.map(p => p.vertexIndex)).size !== pins.length) failEdit("pins 顶点不能重复");
  const result = await runWeightSolver({
    vertices: info.vertices.map((_, i) => [positions[i * 2], positions[i * 2 + 1]]),
    triangles: Array.from({ length: info.attachment.triangles.length / 3 }, (_, i) => info.attachment.triangles.slice(i * 3, i * 3 + 3)),
    bones: selected.map(b => [b.worldX, b.worldY, b.worldX + b.a * b.data.length, b.worldY + b.c * b.data.length]), pins,
  });
  const weights: number[][] = result.weights;
  if (!Array.isArray(weights) || weights.length !== info.vertices.length || weights.some(row => !Array.isArray(row) || row.length !== selected.length
    || row.some(w => !Number.isFinite(w) || w < 0 || w > 1.000001) || Math.abs(row.reduce((a, b) => a + b, 0) - 1) > 1e-5)) failEdit("外部求解器返回的权重布局或数值无效");
  const encoded: number[] = [];
  for (let i = 0; i < weights.length; i++) {
    const ranked = weights[i].map((weight, bone) => ({ weight, bone })).sort((a, b) => b.weight - a.weight);
    let kept = ranked.filter(v => v.weight >= (options.threshold ?? 0.001) && v.weight > 0).slice(0, options.maxInfluences ?? 4);
    if (!kept.length) kept = ranked.slice(0, 1);
    const sum = kept.reduce((s, v) => s + v.weight, 0); if (!(sum > 0)) failEdit("求解器产生零权重顶点");
    kept.sort((a, b) => selected[a.bone].data.index - selected[b.bone].data.index);
    encoded.push(kept.length);
    for (const v of kept) {
      const bone = selected[v.bone], point = inversePoint(bone, positions[i * 2], positions[i * 2 + 1]);
      encoded.push(bone.data.index, point[0], point[1], v.weight / sum);
    }
  }
  // Construct the entire result before changing the target attachment or its FFD.
  info.attachment.vertices = encoded;
  for (const atts of tracks) delete atts[target.attachmentName];
  return { backend: "libigl-bbw", vertexCount: weights.length, bones: options.bones,
    maxInfluences: options.maxInfluences ?? 4, clearedDeformAnimations: tracks.length,
    pins: (result.pins ?? []).map((p: any) => ({ vertexIndex: p.vertexIndex, boneName: options.bones[p.boneIndex] })) };
}
