import { adapterForJson } from "./project-context";
import { skeletonSnapshot as snapshot38 } from "./adapters/v38/validation";

export function validateRebuildJson(json: any): void {
  adapterForJson(json, "project.rebuild").json.validate(json);
}
export function verifyRebuiltSkeleton(expected: any, actual: any): void {
  const adapter = adapterForJson(expected, "project.rebuild");
  if (adapterForJson(actual, "project.rebuild") !== adapter) throw new Error("重建前后版本不一致。");
  adapter.json.verify(expected, actual);
}
/** 兼容旧的 3.8 快照调用；后续版本应使用自己的 adapter.json.verify。 */
export function skeletonSnapshot(json: any): any {
  const adapter = adapterForJson(json, "project.rebuild");
  if (adapter.family !== "3.8") throw new Error("此快照接口仅适用于 3.8。");
  return snapshot38(json);
}
