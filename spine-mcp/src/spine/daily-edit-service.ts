import { failEdit, safeName, findAttachment, MeshTarget } from "./mesh-edit-service";

export function editEvents(json: any, operations: any[]): { affected: number } {
  let affected = 0;
  const references = (name: string) => Object.values<any>(json.animations ?? {}).flatMap(a => (a.events ?? []).filter((f: any) => f.name === name));
  for (const op of operations) {
    safeName(op.eventName);
    json.events ??= {};
    const exists = Object.hasOwn(json.events, op.eventName);
    if (["create", "update"].includes(op.action)) {
      if (op.action === "create" && exists) failEdit(`事件已存在：${op.eventName}`);
      if (op.action === "update" && !exists) failEdit(`事件不存在：${op.eventName}`);
      const values: any = {};
      for (const key of ["int", "float", "string", "audio", "volume", "balance"]) if (op[key] !== undefined) values[key] = op[key];
      json.events[op.eventName] = { ...(json.events[op.eventName] ?? {}), ...values }; affected++;
    } else if (op.action === "rename") {
      safeName(op.newName);
      if (!exists || Object.hasOwn(json.events, op.newName)) failEdit("原事件不存在或目标名称已存在");
      json.events[op.newName] = json.events[op.eventName]; delete json.events[op.eventName];
      for (const frame of references(op.eventName)) frame.name = op.newName;
      affected++;
    } else if (op.action === "delete") {
      if (!exists) failEdit(`事件不存在：${op.eventName}`);
      if (references(op.eventName).length && !op.cascade) failEdit("事件仍被动画引用，删除需要 cascade=true");
      for (const anim of Object.values<any>(json.animations ?? {})) if (anim.events) anim.events = anim.events.filter((f: any) => f.name !== op.eventName);
      delete json.events[op.eventName]; affected++;
    } else {
      const animation = json.animations?.[op.animationName];
      if (!animation || !exists) failEdit("动画或事件不存在");
      const frames = (animation.events ??= []);
      if (op.action === "keyframe_upsert") {
        if (!Number.isFinite(op.time) || op.time < 0) failEdit("需要非负 time");
        const same = frames.filter((f: any) => f.name === op.eventName && Math.abs((f.time ?? 0) - op.time) < 1e-6);
        if (same.length > 1) failEdit("同时间存在多个同名事件，请先删除该范围再添加");
        const frame = same[0] ?? { time: op.time, name: op.eventName };
        for (const key of ["int", "float", "string", "volume", "balance"]) if (op[key] !== undefined) frame[key] = op[key];
        if (!same.length) frames.push(frame); affected++;
      } else if (op.action === "keyframe_delete" || op.action === "keyframe_shift") {
        const start = op.startTime ?? op.time ?? 0, end = op.endTime ?? op.time ?? Infinity;
        if (end < start) failEdit("结束时间不能小于开始时间");
        const matched = (f: any) => f.name === op.eventName && (f.time ?? 0) >= start && (f.time ?? 0) <= end;
        if (op.action === "keyframe_delete") animation.events = frames.filter((f: any) => { if (!matched(f)) return true; affected++; return false; });
        else {
          if (!Number.isFinite(op.offset)) failEdit("事件移动需要 offset");
          for (const f of frames) if (matched(f)) { const time = (f.time ?? 0) + op.offset; if (time < 0) failEdit("移动后事件时间小于 0"); f.time = time; affected++; }
        }
      } else failEdit(`未知事件操作：${op.action}`);
      animation.events.sort((a: any, b: any) => (a.time ?? 0) - (b.time ?? 0));
    }
  }
  return { affected };
}

function timelines(animation: any, path: string[] = []): { path: string[]; frames: any[] }[] {
  if (Array.isArray(animation)) return [{ path, frames: animation }];
  if (!animation || typeof animation !== "object") return [];
  return Object.entries(animation).flatMap(([key, value]) => timelines(value, [...path, key]));
}
function put(animation: any, path: string[], frames: any[]): void {
  let parent = animation; for (const key of path.slice(0, -1)) parent = (parent[key] ??= {});
  parent[path.at(-1)!] = frames;
}
export interface RangeOptions {
  animationName: string; action: "copy" | "shift" | "scale" | "reverse" | "delete" | "quantize";
  startTime?: number; endTime?: number; timelinePaths?: string[][]; targetAnimation?: string; targetTime?: number;
  offset?: number; scale?: number; fps?: number; collision?: "reject" | "replace";
}
/** 跨时间轴复制、变速、反转和整帧对齐，连同事件、FFD 和约束一起处理。 */
export function animationRange(json: any, options: RangeOptions): any {
  safeName(options.animationName);
  const source = json.animations?.[options.animationName];
  if (!source) failEdit(`动画不存在：${options.animationName}`);
  const start = options.startTime ?? 0, end = options.endTime ?? Infinity;
  if (end < start) failEdit("endTime 不能小于 startTime");
  if (["reverse", "scale"].includes(options.action) && !Number.isFinite(end)) failEdit("反转/变速需要 endTime");
  if (options.action === "shift" && !Number.isFinite(options.offset)) failEdit("shift 需要 offset");
  if (options.action === "scale" && (!Number.isFinite(options.scale) || options.scale! <= 0)) failEdit("scale 需要正数倍率");
  if (options.action === "quantize" && (!Number.isFinite(options.fps) || options.fps! <= 0)) failEdit("quantize 需要正数 fps");
  const all = timelines(source), chosen = options.timelinePaths ? options.timelinePaths.map(p => {
    if (p.some(k => ["__proto__", "constructor", "prototype"].includes(k))) failEdit("时间轴路径无效");
    const found = all.find(t => JSON.stringify(t.path) === JSON.stringify(p));
    if (!found) failEdit(`时间轴不存在：${JSON.stringify(p)}`);
    return found!;
  }) : all;
  const destination = options.action === "copy" ? options.targetAnimation ?? options.animationName : options.animationName;
  safeName(destination);
  const target = structuredClone(json.animations[destination] ?? {});
  let affected = 0;
  for (const timeline of chosen) {
    const selected = timeline.frames.filter(f => (f.time ?? 0) >= start && (f.time ?? 0) <= end);
    if (!selected.length) continue;
    let moved = structuredClone(selected);
    if (options.action === "reverse") {
      if (selected.some(f => f.curve === "stepped")) failEdit("阶跃时间轴反转需要先烘焙，当前操作已取消");
      moved = moved.reverse().map(f => { for (const k of ["curve", "c2", "c3", "c4"]) delete f[k]; return f; });
      for (let i = 0; i < moved.length - 1; i++) {
        const curve = selected[selected.length - 2 - i];
        if (typeof curve.curve === "number") Object.assign(moved[i], { curve: 1 - (curve.c3 ?? 1), c2: 1 - (curve.c4 ?? 1), c3: 1 - curve.curve, c4: 1 - (curve.c2 ?? 0) });
      }
    }
    for (const frame of moved) {
      const time = frame.time ?? 0;
      frame.time = options.action === "copy" ? (options.targetTime ?? start) + time - start
        : options.action === "shift" ? time + options.offset!
        : options.action === "scale" ? start + (time - start) * options.scale!
        : options.action === "reverse" ? start + end - time
        : options.action === "quantize" ? Math.round(time * options.fps!) / options.fps! : time;
      frame.time = Number(frame.time.toFixed(6));
      if (frame.time < 0) failEdit("操作导致关键帧时间小于 0");
    }
    let parent = target; for (const key of timeline.path.slice(0, -1)) parent = (parent[key] ??= {});
    const old: any[] = parent[timeline.path.at(-1)!] ?? [];
    let frames = options.action === "copy" ? structuredClone(old) : old.filter(f => (f.time ?? 0) < start || (f.time ?? 0) > end);
    if (options.action !== "delete") for (const frame of moved) {
      const collision = frames.findIndex(f => Math.abs((f.time ?? 0) - frame.time) < 1e-6);
      if (timeline.path[0] !== "events" && collision >= 0) {
        if (options.collision !== "replace") failEdit(`操作产生关键帧冲突：${timeline.path.join("/")} @${frame.time}`);
        frames[collision] = frame;
      } else frames.push(frame);
    }
    frames.sort((a, b) => (a.time ?? 0) - (b.time ?? 0)); put(target, timeline.path, frames); affected += selected.length;
  }
  json.animations[destination] = target;
  return { affectedKeyframes: affected, animationName: destination, boundaryInterpolation: "只处理范围内已有关键帧，不自动补范围边界帧" };
}

export function manageAttachment(json: any, target: MeshTarget, options: { action: "rename" | "duplicate" | "convert_to_mesh";
  newName?: string; targetSkinName?: string }): any {
  const attachment = findAttachment(json, target);
  const skins: any[] = Array.isArray(json.skins) ? json.skins : Object.entries(json.skins ?? {}).map(([name, attachments]) => ({ name, attachments }));
  if (options.action === "convert_to_mesh") {
    if ((attachment.type ?? "region") !== "region") failEdit("仅 region 附件可转换为四顶点网格");
    if (!attachment.width || !attachment.height) failEdit("转换需要附件 width/height");
    const angle = (attachment.rotation ?? 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle), vertices: number[] = [];
    for (const [x, y] of [[-1, -1], [-1, 1], [1, 1], [1, -1]]) {
      const lx = x * attachment.width * (attachment.scaleX ?? 1) / 2, ly = y * attachment.height * (attachment.scaleY ?? 1) / 2;
      vertices.push(lx * cos - ly * sin + (attachment.x ?? 0), lx * sin + ly * cos + (attachment.y ?? 0));
    }
    Object.assign(attachment, { type: "mesh", vertices, uvs: [0, 1, 0, 0, 1, 0, 1, 1], triangles: [0, 1, 2, 2, 3, 0], hull: 4, edges: [0, 2, 2, 4, 4, 6, 6, 0] });
    for (const key of ["x", "y", "rotation", "scaleX", "scaleY"]) delete attachment[key];
    return { vertexCount: 4, attachmentName: target.attachmentName };
  }
  const name = options.newName!; safeName(name);
  if (options.action === "duplicate") {
    const skin = skins.find(s => s.name === (options.targetSkinName ?? target.skinName ?? "default"));
    if (!skin) failEdit("目标皮肤不存在");
    const atts = ((skin.attachments ??= {})[target.slotName] ??= {});
    if (Object.hasOwn(atts, name)) failEdit("目标附件已存在");
    atts[name] = structuredClone(attachment);
    if (atts[name].name !== undefined) atts[name].name = name;
    if (!atts[name].path) atts[name].path = attachment.path ?? target.attachmentName;
    for (const anim of Object.values<any>(json.animations ?? {})) {
      const frames = anim.deform?.[target.skinName ?? "default"]?.[target.slotName]?.[target.attachmentName];
      if (frames) (((anim.deform ??= {})[skin.name] ??= {})[target.slotName] ??= {})[name] = structuredClone(frames);
    }
  } else {
    // 同插槽各皮肤的同名 placeholder 一起改名，保持动画换装引用。
    for (const skin of skins) if (skin.attachments?.[target.slotName]?.[target.attachmentName]) {
      const atts = skin.attachments[target.slotName];
      if (Object.hasOwn(atts, name)) failEdit(`目标附件已存在：${skin.name}/${name}`);
    }
    for (const skin of skins) {
      const atts = skin.attachments?.[target.slotName];
      if (atts?.[target.attachmentName]) {
        const a = atts[target.attachmentName]; if (!a.path) a.path = target.attachmentName;
        if (a.name !== undefined) a.name = name; atts[name] = a; delete atts[target.attachmentName];
      }
      for (const a of Object.values<any>(atts ?? {})) if (a.parent === target.attachmentName) a.parent = name;
    }
    const slot = json.slots.find((s: any) => s.name === target.slotName);
    if (slot.attachment === target.attachmentName) slot.attachment = name;
    for (const anim of Object.values<any>(json.animations ?? {})) {
      for (const frame of anim.slots?.[target.slotName]?.attachment ?? []) if (frame.name === target.attachmentName) frame.name = name;
      for (const slots of Object.values<any>(anim.deform ?? {})) {
        const atts = slots[target.slotName]; if (atts?.[target.attachmentName]) { atts[name] = atts[target.attachmentName]; delete atts[target.attachmentName]; }
      }
    }
  }
  return { attachmentName: name, action: options.action };
}
