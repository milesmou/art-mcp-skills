import { isDeepStrictEqual } from "util";
import { ErrorCode, SpineError } from "../utils/error-codes";

export interface JsonEdit { op: "add" | "replace" | "remove" | "copy" | "move" | "test"; path: string; from?: string; value?: any; }
const fail = (message: string): never => { throw new SpineError(ErrorCode.INVALID_ARGUMENT, message); };
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
function pointer(value: string): string[] {
  if (!value.startsWith("/") || /~(?![01])/.test(value)) return fail(`无效 JSON Pointer：${value}`);
  const parts = value.slice(1).split("/").map(v => v.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (parts.some(v => forbidden.has(v))) return fail("路径包含不允许的键名");
  return parts;
}
function index(array: any[], key: string, append = false): number {
  if (key === "-" && append) return array.length;
  if (!/^(0|[1-9]\d*)$/.test(key)) return fail(`数组索引无效：${key}`);
  const n = Number(key);
  if (n > array.length || (!append && n === array.length)) return fail(`数组索引越界：${key}`);
  return n;
}
function location(json: any, parts: string[]): { parent: any; key: string } {
  let parent = json;
  for (const key of parts.slice(0, -1)) {
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key)) return fail(`路径不存在：/${parts.join("/")}`);
    parent = parent[Array.isArray(parent) ? index(parent, key) : key];
  }
  if (!parent || typeof parent !== "object") return fail("路径父级不是对象或数组");
  return { parent, key: parts.at(-1)! };
}
function read(json: any, parts: string[]): any {
  const { parent, key } = location(json, parts);
  if (!Object.hasOwn(parent, key)) return fail(`路径不存在：/${parts.join("/")}`);
  return parent[Array.isArray(parent) ? index(parent, key) : key];
}

/** 一次事务中执行结构化 JSON Patch；不执行任意代码。失败时原数据也不变。 */
export function applyJsonEdits(json: any, operations: JsonEdit[]): any {
  const result = structuredClone(json);
  for (const op of operations) {
    if (["add", "replace", "test"].includes(op.op) && !Object.hasOwn(op, "value")) fail(`${op.op} 需要 value`);
    const parts = pointer(op.path);
    let value = op.value;
    if (op.op === "test") { if (!isDeepStrictEqual(read(result, parts), value)) fail(`test 条件不满足：${op.path}`); continue; }
    if (op.op === "copy" || op.op === "move") {
      if (!op.from) fail(`${op.op} 需要 from`);
      const from = pointer(op.from!);
      if (op.op === "move" && op.path.startsWith(op.from! + "/")) fail("不能将父节点移入其子节点");
      value = structuredClone(read(result, from));
      if (op.op === "move") { const loc = location(result, from); if (Array.isArray(loc.parent)) loc.parent.splice(index(loc.parent, loc.key), 1); else delete loc.parent[loc.key]; }
    }
    const { parent, key } = location(result, parts);
    if (op.op === "remove" || op.op === "replace") {
      read(result, parts);
      if (Array.isArray(parent)) parent.splice(index(parent, key), 1, ...(op.op === "replace" ? [structuredClone(value)] : []));
      else if (op.op === "remove") delete parent[key]; else parent[key] = structuredClone(value);
    } else if (["add", "copy", "move"].includes(op.op)) {
      if (value === undefined) fail(`${op.op} 需要 value 或有效 from`);
      if (Array.isArray(parent)) parent.splice(index(parent, key, true), 0, structuredClone(value));
      else parent[key] = structuredClone(value);
    } else fail(`未知操作：${op.op}`);
  }
  return result;
}

export function editAnimation(json: any, name: string, animation: any, mode: "create" | "replace" | "merge", eventDefinitions?: Record<string, any>): void {
  if (!name || forbidden.has(name) || !animation || Array.isArray(animation) || typeof animation !== "object") fail("需要动画名和 Spine 动画对象");
  for (const key of Object.keys(animation)) if (!["bones", "slots", "ik", "transform", "paths", "deform", "drawOrder", "events"].includes(key)) fail(`未知动画时间轴类型：${key}`);
  json.animations ??= {};
  const exists = Object.hasOwn(json.animations, name);
  if (mode === "create" && exists) fail(`动画已存在：${name}`);
  if (mode === "replace" && !exists) fail(`动画不存在：${name}`);
  for (const frame of animation.events ?? []) {
    if (frame.name && forbidden.has(frame.name)) fail("不允许的事件名");
    if (frame.name && !Object.hasOwn(json.events ?? {}, frame.name) && Object.hasOwn(eventDefinitions ?? {}, frame.name)) {
      json.events ??= {};
      json.events[frame.name] = structuredClone(eventDefinitions![frame.name]);
    }
  }
  const merge = (target: any, source: any): any => {
    if (Array.isArray(source) || source === null || typeof source !== "object") return structuredClone(source);
    const out = target && typeof target === "object" && !Array.isArray(target) ? structuredClone(target) : {};
    for (const [key, value] of Object.entries(source)) { if (forbidden.has(key)) fail("不允许的属性名"); out[key] = merge(out[key], value); }
    return out;
  };
  json.animations[name] = mode === "merge" ? merge(json.animations[name], animation) : merge({}, animation);
}

export function editKeyframes(json: any, animationName: string, timeline: string[], operation: string,
  options: { frames?: any[]; startTime?: number; endTime?: number; offset?: number }): number {
  if (!Object.hasOwn(json.animations ?? {}, animationName)) fail(`动画不存在：${animationName}`);
  if (!timeline.length || timeline.some(k => forbidden.has(k))) fail("时间轴路径无效");
  let parent = json.animations[animationName];
  for (const key of timeline.slice(0, -1)) {
    if (!Object.hasOwn(parent, key)) { if (operation !== "upsert" && operation !== "replace") fail(`时间轴不存在：${timeline.join("/")}`); parent[key] = {}; }
    parent = parent[key];
    if (!parent || typeof parent !== "object" || Array.isArray(parent)) fail("时间轴父级必须是对象");
  }
  const key = timeline.at(-1)!;
  let frames = parent[key] ?? [];
  if (!Array.isArray(frames)) fail("目标不是关键帧数组");
  const begin = options.startTime ?? 0, end = options.endTime ?? Infinity;
  if (end < begin) fail("endTime 不能小于 startTime");
  let affected = 0;
  if (operation === "replace" || operation === "upsert") {
    if (!options.frames?.length) fail("需要非空 frames");
    frames = operation === "replace" ? [] : structuredClone(frames);
    for (const f of options.frames!) {
      if (!f || Array.isArray(f) || typeof f !== "object" || !Number.isFinite(f.time ?? 0) || (f.time ?? 0) < 0) fail("关键帧 time 必须为非负数");
      const i = frames.findIndex((v: any) => Math.abs((v.time ?? 0) - (f.time ?? 0)) < 0.000001 && (timeline[0] !== "events" || v.name === f.name));
      if (i < 0) frames.push(structuredClone(f)); else frames[i] = { ...frames[i], ...structuredClone(f) };
      affected++;
    }
  } else if (operation === "delete") {
    frames = frames.filter((v: any) => { const match = (v.time ?? 0) >= begin && (v.time ?? 0) <= end; if (match) affected++; return !match; });
  } else if (operation === "shift") {
    if (!Number.isFinite(options.offset)) fail("shift 需要 offset 秒数");
    frames = frames.map((f: any) => {
      if ((f.time ?? 0) < begin || (f.time ?? 0) > end) return f;
      const time = (f.time ?? 0) + options.offset!;
      if (time < 0) fail("移动后关键帧时间小于 0");
      affected++; return { ...f, time };
    });
  } else fail(`未知关键帧操作：${operation}`);
  frames.sort((a: any, b: any) => (a.time ?? 0) - (b.time ?? 0));
  if (timeline[0] !== "events" && frames.some((f: any, i: number) => i > 0 && Math.abs((f.time ?? 0) - (frames[i - 1].time ?? 0)) < 0.000001)) fail("操作产生同一时间的重复关键帧");
  parent[key] = frames;
  return affected;
}
