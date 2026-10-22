import sharp from "sharp";
import { findAttachment, failEdit, MeshTarget, meshInfo, meshRebindTracks, worldVertices, inversePoint } from "./mesh-edit-service";
import { readSkeletonData, sampleSkeleton } from "./runtime-core";
const triangulate: (points: number[][], edges: number[][], options: any) => number[][] = require("cdt2d");
type Point = [number, number];
export interface GenerateMeshOptions {
  imagePath: string; mode?: "trace" | "grid"; alphaThreshold?: number; simplify?: number;
  spacing?: number; maxVertices?: number; islandMode?: "reject" | "largest";
  replaceExisting?: boolean; deformPolicy?: "reject" | "clear";
}
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function distance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function simplifyLine(points: Point[], tolerance: number): Point[] {
  const keep = new Set([0, points.length - 1]), stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!; let best = tolerance, index = -1;
    for (let i = a + 1; i < b; i++) { const d = distance(points[i], points[a], points[b]); if (d > best) { best = d; index = i; } }
    if (index !== -1) { keep.add(index); stack.push([a, index], [index, b]); }
  }
  return [...keep].sort((a, b) => a - b).map(i => points[i]);
}
function inside(p: Point, polygon: Point[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}

/** Follow pixel edges rather than pixel centers, so one-pixel features still have area. */
function outline(alpha: Uint8Array, width: number, height: number, threshold: number, tolerance: number, islandMode: string): { polygon: Point[]; islands: number; holes: number } {
  const edges: { a: Point; b: Point; dir: number; used?: boolean }[] = [];
  const outgoing = new Map<string, number[]>();
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && alpha[y * width + x] > threshold;
  const add = (a: Point, b: Point, dir: number) => {
    if (edges.length >= 200000) failEdit("轮廓过于复杂，请先缩小图片或清理碎点");
    const key = `${a[0]},${a[1]}`, list = outgoing.get(key) ?? []; list.push(edges.length); outgoing.set(key, list); edges.push({ a, b, dir });
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (solid(x, y)) {
    if (!solid(x, y - 1)) add([x, y], [x + 1, y], 0);
    if (!solid(x + 1, y)) add([x + 1, y], [x + 1, y + 1], 1);
    if (!solid(x, y + 1)) add([x + 1, y + 1], [x, y + 1], 2);
    if (!solid(x - 1, y)) add([x, y + 1], [x, y], 3);
  }
  const loops: { points: Point[]; area: number }[] = [];
  for (const first of edges) if (!first.used) {
    let edge = first; const points: Point[] = [];
    do {
      edge.used = true; points.push(edge.a);
      if (edge.b[0] === first.a[0] && edge.b[1] === first.a[1]) break;
      const choices = (outgoing.get(`${edge.b[0]},${edge.b[1]}`) ?? []).map(i => edges[i]).filter(e => !e.used);
      // Right turn separates components touching only at a corner.
      const order = [1, 0, 3, 2];
      choices.sort((a, b) => order.indexOf((a.dir - edge.dir + 4) % 4) - order.indexOf((b.dir - edge.dir + 4) % 4));
      if (!choices.length) return failEdit("无法闭合图片轮廓");
      edge = choices[0];
    } while (points.length <= edges.length);
    let area = 0; for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; area += a[0] * b[1] - b[0] * a[1]; }
    loops.push({ points, area });
  }
  const outer = loops.filter(l => l.area > 0).sort((a, b) => b.area - a.area);
  if (!outer.length) return failEdit("图片在透明阈值下没有可用轮廓");
  if (outer.length > 1 && islandMode !== "largest") failEdit(`图片包含 ${outer.length} 个独立区域；请先拆分，或显式 islandMode=largest`);
  let polygon = outer[0].points.filter((p, i, ps) => cross(ps[(i + ps.length - 1) % ps.length], p, ps[(i + 1) % ps.length]) !== 0);
  if (polygon.length > 3 && tolerance > 0) {
    let far = 1;
    for (let i = 2; i < polygon.length; i++) if (Math.hypot(polygon[i][0] - polygon[0][0], polygon[i][1] - polygon[0][1]) > Math.hypot(polygon[far][0] - polygon[0][0], polygon[far][1] - polygon[0][1])) far = i;
    polygon = [...simplifyLine(polygon.slice(0, far + 1), tolerance).slice(0, -1), ...simplifyLine([...polygon.slice(far), polygon[0]], tolerance).slice(0, -1)];
  }
  if (polygon.length < 3) failEdit("简化后不足三个顶点，请减小 simplify");
  return { polygon: polygon.reverse(), islands: outer.length, holes: loops.filter(l => l.area < 0).length };
}

export async function buildImageMesh(options: GenerateMeshOptions): Promise<any> {
  const { data, info } = await sharp(options.imagePath, { limitInputPixels: 4194304 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const alpha = Uint8Array.from({ length: width * height }, (_, i) => data[i * channels + channels - 1]);
  const spacing = options.spacing ?? 16, max = options.maxVertices ?? 2048;
  const columns = Math.ceil(width / spacing), rows = Math.ceil(height / spacing);
  const grid = options.mode === "grid";
  if (grid && (columns + 1) * (rows + 1) > max) failEdit("规则网格超过 maxVertices，请增加 spacing");
  const gridX = (i: number) => i * width / columns, gridY = (i: number) => i * height / rows;
  const gridHull: Point[] = grid ? [
    ...Array.from({ length: columns + 1 }, (_, i) => [gridX(i), height] as Point),
    ...Array.from({ length: rows }, (_, i) => [width, gridY(rows - i - 1)] as Point),
    ...Array.from({ length: columns }, (_, i) => [gridX(columns - i - 1), 0] as Point),
    ...Array.from({ length: rows - 1 }, (_, i) => [0, gridY(i + 1)] as Point),
  ] : [];
  const traced = grid ? { polygon: gridHull, islands: 1, holes: 0 }
    : outline(alpha, width, height, options.alphaThreshold ?? 16, options.simplify ?? 2, options.islandMode ?? "reject");
  const polygon = traced.polygon;
  if (polygon.length > max) failEdit("轮廓顶点超过 maxVertices，请增加 simplify");
  const onSegment = (p: Point, a: Point, b: Point) => Math.abs(cross(a, b, p)) < 1e-8 && distance(p, a, b) < 1e-8;
  for (let i = 0; i < polygon.length; i++) for (let j = i + 2; j < polygon.length; j++) {
    if (i === 0 && j === polygon.length - 1) continue;
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], c = polygon[j], d = polygon[(j + 1) % polygon.length];
    if ((cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)) failEdit("轮廓存在自交或自接触，请清理图片或调整 simplify");
  }
  const points: Point[] = [...polygon];
  const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  if ((maxX - minX) * (maxY - minY) / spacing ** 2 > 100000) failEdit("采样过密，请增加 spacing");
  const samplesX = grid ? Array.from({ length: columns - 1 }, (_, i) => gridX(i + 1))
    : Array.from({ length: Math.max(0, Math.ceil((maxX - minX) / spacing) - 1) }, (_, i) => minX + (i + 1) * spacing);
  const samplesY = grid ? Array.from({ length: rows - 1 }, (_, i) => gridY(i + 1))
    : Array.from({ length: Math.max(0, Math.ceil((maxY - minY) / spacing) - 1) }, (_, i) => minY + (i + 1) * spacing);
  for (const y of samplesY) for (const x of samplesX) {
    const p: Point = [x, y];
    if (inside(p, polygon) && polygon.every((a, i) => distance(p, a, polygon[(i + 1) % polygon.length]) > 1e-6)) {
      if (points.length >= max) failEdit("内部布点超过 maxVertices，请增加 spacing");
      points.push(p);
    }
  }
  const edges = polygon.map((_, i) => [i, (i + 1) % polygon.length]);
  const cells = triangulate(points, edges, { exterior: false });
  if (!cells.length || cells.some(c => c.length !== 3 || c.some(i => !Number.isInteger(i) || !points[i]) || Math.abs(cross(points[c[0]], points[c[1]], points[c[2]])) < 1e-8)) failEdit("三角剖分失败或产生退化三角形");
  return { width, height, points, hull: polygon.length, uvs: points.flatMap(([x, y]) => [x / width, y / height]),
    triangles: cells.flat(), edges: edges.flatMap(([a, b]) => [a * 2, b * 2]), backend: "alpha-contour+cdt2d", islands: traced.islands, filledHoles: traced.holes };
}

export async function generateMesh(json: any, target: MeshTarget, options: GenerateMeshOptions): Promise<any> {
  const attachment = findAttachment(json, target), type = attachment.type ?? "region";
  if (type !== "region" && type !== "mesh") failEdit("自动网格仅支持 region 或独立 mesh 附件");
  if (attachment.parent) failEdit("关联网格请编辑源网格");
  if (type === "mesh" && !options.replaceExisting) failEdit("已有网格需显式 replaceExisting=true；将替换拓扑和权重");
  const tracks = meshRebindTracks(json, target, options.deformPolicy);
  const mesh = await buildImageMesh(options);
  let vertices: number[];
  if (type === "region") {
    const angle = (attachment.rotation ?? 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const w = attachment.width ?? mesh.width, h = attachment.height ?? mesh.height;
    if (!(w > 0 && h > 0)) failEdit("附件尺寸必须大于零");
    vertices = mesh.points.flatMap(([x, y]: Point) => {
      const px = (x / mesh.width - 0.5) * w * (attachment.scaleX ?? 1), py = (0.5 - y / mesh.height) * h * (attachment.scaleY ?? 1);
      return [(attachment.x ?? 0) + px * cos - py * sin, (attachment.y ?? 0) + px * sin + py * cos];
    });
  } else {
    meshInfo(json, target);
    const sk = sampleSkeleton(readSkeletonData(json), undefined, 0, target.skinName), positions = worldVertices(sk, target);
    const slot = sk.findSlot(target.slotName);
    const local = Array.from({ length: positions.length / 2 }, (_, i) => inversePoint(slot.bone, positions[i * 2], positions[i * 2 + 1]));
    vertices = [];
    for (let i = 0; i < mesh.uvs.length; i += 2) {
      const p: Point = [mesh.uvs[i], mesh.uvs[i + 1]]; let mapped = false;
      for (let j = 0; j < attachment.triangles.length; j += 3) {
        const ids = attachment.triangles.slice(j, j + 3), uv = ids.map((k: number) => [attachment.uvs[k * 2], attachment.uvs[k * 2 + 1]] as Point);
        const det = cross(uv[0], uv[1], uv[2]); if (Math.abs(det) < 1e-12) continue;
        const weights = [cross(p, uv[1], uv[2]) / det, cross(uv[0], p, uv[2]) / det, cross(uv[0], uv[1], p) / det];
        if (weights.every(w => w >= -1e-7)) { vertices.push(...[0, 1].map(axis => ids.reduce((sum: number, k: number, n: number) => sum + weights[n] * local[k][axis], 0))); mapped = true; break; }
      }
      if (!mapped) failEdit("新顶点超出旧网格 UV 覆盖范围，无法保持 setup 外形；请先使用 region 附件");
    }
  }
  const replacement: any = { type: "mesh", width: attachment.width ?? mesh.width, height: attachment.height ?? mesh.height,
    uvs: mesh.uvs, vertices, triangles: mesh.triangles, hull: mesh.hull, edges: mesh.edges };
  for (const key of ["path", "color", "name"]) if (attachment[key] !== undefined) replacement[key] = attachment[key];
  for (const key of Object.keys(attachment)) delete attachment[key]; Object.assign(attachment, replacement);
  for (const atts of tracks) delete atts[target.attachmentName];
  return { backend: mesh.backend, vertexCount: vertices.length / 2, triangleCount: mesh.triangles.length / 3, hull: mesh.hull,
    islands: mesh.islands, filledHoles: mesh.filledHoles, clearedDeformAnimations: tracks.length };
}
