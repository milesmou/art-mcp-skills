import { CAPABILITIES, Capability, SpineAdapter } from "./types";
import { versionFamily } from "../version-policy";
import { ErrorCode, SpineError } from "../../utils/error-codes";
import * as runtime38 from "./v38/runtime";
import * as json38 from "./v38/validation";
import * as cli38 from "./v38/cli";
import * as preview38 from "./v38/render";

function capabilities(supported: boolean): SpineAdapter["capabilities"] {
  return Object.freeze(Object.fromEntries(CAPABILITIES.map(name => [name, Object.freeze({
    supported: name === "metadata.read" || (supported && !name.startsWith("physics.")),
    ...(!supported && name !== "metadata.read" ? { reason: "4.2 适配器尚未实现，仅可查询版本及能力" }
      : name.startsWith("physics.") ? { reason: "3.8 适配器不支持 4.2 物理约束" } : {}),
  })])) as unknown as SpineAdapter["capabilities"]);
}
const pending = (): never => { throw new SpineError(ErrorCode.UNSUPPORTED_VERSION, "Spine 4.2 已预留适配器，尚未开放读取、编辑或重建。"); };
const adapter38: SpineAdapter = Object.freeze({ family: "3.8", status: "supported", capabilities: capabilities(true),
  runtime: Object.freeze({ getCore: runtime38.getCoreRuntime, readData: runtime38.readSkeletonData, sample: runtime38.sampleSkeleton }),
  preview: Object.freeze({ isAvailable: preview38.isRuntimeRenderAvailable, renderFrame: preview38.renderRuntimeFrame }),
  json: Object.freeze({ validate: json38.validateRebuildJson, verify: json38.verifyRebuiltSkeleton,
    deformPath: (skin: string, slot: string, attachment: string) => ["deform", skin, slot, attachment] }),
  cli: Object.freeze({ exportSettings: cli38.generateExportSettings, importArgs: cli38.importArgs }) });
const adapter42: SpineAdapter = Object.freeze({ family: "4.2", status: "planned", capabilities: capabilities(false),
  runtime: Object.freeze({ getCore: pending, readData: pending, sample: pending }),
  preview: Object.freeze({ isAvailable: () => false, renderFrame: pending }),
  json: Object.freeze({ validate: pending, verify: pending, deformPath: pending }),
  cli: Object.freeze({ exportSettings: pending, importArgs: pending }) });
const adapters: ReadonlyMap<string, SpineAdapter> = new Map([["3.8", adapter38], ["4.2", adapter42]]);

export function registeredAdapters(): SpineAdapter[] { return [...adapters.values()]; }
export function findAdapter(version: unknown): SpineAdapter | undefined { return adapters.get(versionFamily(version) ?? ""); }
export function requireAdapter(version: unknown, capability?: Capability): SpineAdapter {
  const adapter = findAdapter(version);
  if (!adapter) throw new SpineError(ErrorCode.UNSUPPORTED_VERSION, `未注册 Spine 版本适配器：${String(version)}`);
  if (capability) assertCapability(adapter, capability);
  return adapter;
}
export function assertCapability(adapter: SpineAdapter, capability: Capability): void {
  const entry = adapter.capabilities[capability];
  if (!entry?.supported) throw new SpineError(ErrorCode.UNSUPPORTED_CAPABILITY,
    `Spine ${adapter.family} 不支持 ${capability}：${entry?.reason ?? "此能力尚未实现"}`);
}
