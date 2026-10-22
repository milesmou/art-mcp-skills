import * as fs from "fs";
import { currentProjectContext } from "./execution-context";
import { requireAdapter } from "./adapters/registry";
import { adapterForJson } from "./project-context";
import sharp from "sharp";
export type { RuntimeFrameOptions, RuntimeFrameResult } from "./preview-types";
import type { RuntimeFrameOptions, RuntimeFrameResult } from "./preview-types";

/** 是否可用取决于当前版本自己的预览实现和可选依赖。 */
export function isRuntimeRenderAvailable(): boolean {
  const adapter = currentProjectContext()?.adapter ?? requireAdapter("3.8");
  return adapter.capabilities["runtime.preview"].supported && adapter.preview.isAvailable();
}
export async function renderRuntimeFrame(options: RuntimeFrameOptions): Promise<RuntimeFrameResult> {
  const json = JSON.parse(fs.readFileSync(options.skeletonJsonPath, "utf8"));
  return adapterForJson(json, "runtime.preview").preview.renderFrame(options);
}
export async function renderRuntimeFrameToPng(options: RuntimeFrameOptions & { outputPath: string }): Promise<Omit<RuntimeFrameResult, "rgba">> {
  const frame = await renderRuntimeFrame(options);
  await sharp(frame.rgba, { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toFile(options.outputPath);
  const { rgba, ...result } = frame;
  return result;
}
