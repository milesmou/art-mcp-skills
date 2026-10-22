import * as path from "path";
import { configManager } from "../config-manager";
import { cliExecutor } from "./cli-executor";
import { currentProjectContext, ProjectExecutionContext, runInProjectContext, withoutProjectContext } from "./execution-context";
import { assertCapability, requireAdapter } from "./adapters/registry";
import type { Capability, SpineAdapter } from "./adapters/types";
import { editorVersionFromOutput, isExactVersion, projectVersionFromOutput, versionFamily } from "./version-policy";
import { createTempDir, removeDir, readJsonFile, writeJsonFile } from "../utils/file-utils";
import { ErrorCode, SpineError } from "../utils/error-codes";

/** JSON 始终保持原生结构；只有对应适配器可以解释其语义。 */
export function adapterForJson(json: any, capability: Capability): SpineAdapter {
  const context = currentProjectContext();
  const version = json?.skeleton?.spine ?? context?.sourceVersion ?? "3.8";
  const adapter = requireAdapter(version, capability);
  if (context && context.family !== adapter.family) {
    throw new SpineError(ErrorCode.VERSION_CONFLICT, `事务版本 ${context.family} 与 JSON 版本 ${version} 不一致；版本迁移必须单独执行。`);
  }
  return adapter;
}

export async function projectMetadata(projectPath: string): Promise<{ sourceVersion: string; editorVersion?: string }> {
  if (path.extname(projectPath).toLowerCase() === ".json") {
    const sourceVersion = readJsonFile(projectPath)?.skeleton?.spine;
    if (!versionFamily(sourceVersion)) throw new SpineError(ErrorCode.UNSUPPORTED_VERSION, "JSON 缺少有效的 skeleton.spine 版本。");
    return { sourceVersion };
  }
  const cfg = { ...configManager.get() };
  const output = await cliExecutor.execToString(["-u", "project", "-i", projectPath], { execution: cfg });
  const sourceVersion = projectVersionFromOutput(output);
  if (!sourceVersion) throw new SpineError(ErrorCode.CLI_EXEC_FAILED, "无法从 Spine CLI 输出中识别工程版本号。");
  return { sourceVersion, editorVersion: editorVersionFromOutput(output) };
}

async function resolveContext(projectPath: string, capability: Capability, sourceHint?: string): Promise<ProjectExecutionContext> {
  const cfg = { ...configManager.get() };
  let sourceVersion = sourceHint;
  let detectedEditor: string | undefined;
  if (!sourceVersion) {
    if (path.extname(projectPath).toLowerCase() === ".json") sourceVersion = readJsonFile(projectPath)?.skeleton?.spine;
    else {
      const output = await cliExecutor.execToString(["-u", "project", "-i", projectPath], { execution: cfg });
      sourceVersion = projectVersionFromOutput(output);
      detectedEditor = editorVersionFromOutput(output);
    }
  }
  const adapter = requireAdapter(sourceVersion, capability);
  const family = adapter.family;
  // 系列配置自动跟随工程；精确补丁配置只在同一系列内覆盖。
  if (isExactVersion(cfg.spineVersion) && versionFamily(cfg.spineVersion) !== family) {
    throw new SpineError(ErrorCode.VERSION_CONFLICT, `配置指定 ${cfg.spineVersion}，工程为 ${sourceVersion}；禁止跨系列打开或重建。`);
  }
  let editorVersion = isExactVersion(cfg.spineVersion) ? cfg.spineVersion
    : detectedEditor ?? (isExactVersion(sourceVersion!) ? sourceVersion! : family);
  // 新建工程的 JSON 可能只有主次版本：只读探测一次，再将实际补丁固定到整个事务。
  const needsCli = path.extname(projectPath).toLowerCase() !== ".json"
    || ["project.export", "project.rebuild", "project.clean", "legacy.edit"].includes(capability);
  if (!isExactVersion(editorVersion) && needsCli) {
    const temp = createTempDir("spine-version-");
    try {
      const input = path.join(temp, "probe.json");
      writeJsonFile(input, { skeleton: { spine: family }, bones: [{ name: "root" }] });
      const output = await cliExecutor.execToString(["-u", family, "-i", input], { execution: cfg });
      editorVersion = editorVersionFromOutput(output) ?? projectVersionFromOutput(output) ?? "";
      if (!isExactVersion(editorVersion)) throw new SpineError(ErrorCode.CLI_EXEC_FAILED, "无法确定实际编辑器补丁版本，已停止操作。");
    } finally { removeDir(temp); }
  }
  if (versionFamily(editorVersion) !== family) throw new SpineError(ErrorCode.VERSION_CONFLICT, `实际编辑器 ${editorVersion} 与工程 ${sourceVersion} 不兼容。`);
  return Object.freeze({ projectPath: path.resolve(projectPath), sourceVersion: sourceVersion!, family, editorVersion,
    spineExe: cfg.spineExe, cliTimeoutMs: cfg.cliTimeoutMs, adapter });
}

/** 一个工程事务固定 CLI、超时、实际编辑器补丁和适配器，异步并发互不污染。 */
export async function withProjectContext<T>(projectPath: string, capability: Capability, run: () => Promise<T>, sourceHint?: string): Promise<T> {
  const current = currentProjectContext();
  const resolved = path.resolve(projectPath);
  const isStage = current && path.dirname(resolved) === path.dirname(current.projectPath) && /^\.spine-mcp-[\da-f-]+\.spine$/i.test(path.basename(resolved));
  if (current && (resolved === current.projectPath || isStage)) {
    assertCapability(current.adapter, capability);
    if (sourceHint && versionFamily(sourceHint) !== current.family) throw new SpineError(ErrorCode.VERSION_CONFLICT, "输入 JSON 的版本与当前事务不一致。");
    return run();
  }
  return runInProjectContext(await withoutProjectContext(() => resolveContext(projectPath, capability, sourceHint)), run);
}
