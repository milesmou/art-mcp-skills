import { currentProjectContext } from "./execution-context";
import { requireAdapter } from "./adapters/registry";
import type { SpineAdapter } from "./adapters/types";
import { adapterForJson } from "./project-context";

const owners = new WeakMap<object, SpineAdapter>();
export function getCoreRuntime(): any {
  return (currentProjectContext()?.adapter ?? requireAdapter("3.8", "runtime.sample")).runtime.getCore();
}
export function readSkeletonData(json: any): any {
  const adapter = adapterForJson(json, "runtime.sample");
  const data = adapter.runtime.readData(json);
  owners.set(data, adapter);
  return data;
}
export function sampleSkeleton(data: any, animationName?: string, time = 0, skinName = "default"): any {
  const adapter = owners.get(data);
  if (!adapter) throw new Error("骨架数据必须由对应版本适配器读取后再采样。");
  return adapter.runtime.sample(data, animationName, time, skinName);
}
