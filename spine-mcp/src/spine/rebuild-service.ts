import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { cliExecutor } from "./cli-executor";
import { exportProject } from "./export-service";
import { parseInfoOutput } from "./info-service";
import { backupFile, createTempDir, removeDir, readJsonFile, writeJsonFile } from "../utils/file-utils";
import { assertProjectUnchanged, projectHash, withProjectLock } from "./project-lock";
import { validateRebuildJson, verifyRebuiltSkeleton } from "./rebuild-validation";
import { ErrorCode, SpineError } from "../utils/error-codes";
import { adapterForJson, withProjectContext } from "./project-context";
import { currentProjectContext } from "./execution-context";
import type { Capability } from "./adapters/types";

export const REBUILD_NOTICE = "通过 JSON 重建 .spine，保留可导出的骨架与动画数据；编辑器文件夹、视图等未导出信息可从原文件备份恢复。";
export interface SkeletonDocument { name: string; json: any; }
export interface RebuildResult {
  projectPath: string; backupPath?: string; skeletonName: string; skeletons: string[];
  fps: number; warnings: string[]; verified: boolean; mode: "rebuild";
  execution: { family: string; sourceVersion: string; editorVersion: string };
}

export async function exportProjectDocuments(projectPath: string, outputDir: string): Promise<{ documents: SkeletonDocument[]; fps: number }> {
  return withProjectContext(projectPath, "project.read", async () => {
    const stdout = await cliExecutor.execToString(["-i", projectPath]);
    const names = [...stdout.matchAll(/^\s*Skeleton:\s*(.+?)\s*$/gm)].map(m => m[1]);
    const files = (await exportProject(projectPath, outputDir, { format: "json" })).filter(f => f.endsWith(".json"));
    if (!names.length || names.length !== files.length || new Set(names).size !== names.length) {
      throw new SpineError(ErrorCode.REBUILD_VALIDATION, `工程骨架列表与导出文件不一致（骨架 ${JSON.stringify(names)}，JSON ${files.map(f => path.basename(f)).join("、")}），已停止操作。`);
    }
    const documents = names.map(name => {
      const file = files.find(f => path.relative(outputDir, f).slice(0, -5).replace(/\\/g, "/") === name.replace(/\\/g, "/"));
      if (!file) throw new SpineError(ErrorCode.REBUILD_VALIDATION, `无法定位骨架 JSON：${name}`);
      const json = readJsonFile(file);
      adapterForJson(json, "project.read");
      return { name, json };
    });
    return { documents, fps: parseInfoOutput(stdout).fps };
  });
}

export function selectSkeleton(documents: SkeletonDocument[], name?: string): SkeletonDocument {
  const result = name ? documents.find(d => d.name === name) : documents.length === 1 ? documents[0] : undefined;
  if (!result) throw new SpineError(ErrorCode.INVALID_ARGUMENT,
    `请指定有效 skeletonName。可选：${documents.map(d => d.name).join("、")}`);
  return result;
}

/** 只写未存在的临时工程，逐一加入所有骨架，校验后以同目录 rename 提交。调用方必须持有锁。 */
export async function rebuildDocuments(
  projectPath: string, documents: SkeletonDocument[], fps: number, expectedHash: string | null,
  skeletonName: string, dryRun = false
): Promise<RebuildResult> {
  if (!documents.length) throw new SpineError(ErrorCode.INVALID_ARGUMENT, "重建至少需要一个骨架。");
  // 在创建任何输出文件前拒绝尚未适配的版本。
  for (const doc of documents) adapterForJson(doc.json, "project.rebuild");
  return withProjectContext(projectPath, "project.rebuild", async () => {
    const context = currentProjectContext()!;
    for (const doc of documents) validateRebuildJson(doc.json);
    const result: RebuildResult = { projectPath, skeletonName, skeletons: documents.map(d => d.name), fps,
      warnings: [REBUILD_NOTICE], verified: false, mode: "rebuild",
      execution: { family: context.family, sourceVersion: context.sourceVersion, editorVersion: context.editorVersion } };
    if (dryRun) return result;
    const tempDir = createTempDir("spine-rebuild-");
    const stage = path.join(path.dirname(projectPath), `.spine-mcp-${randomUUID()}.spine`);
    try {
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        const input = path.join(tempDir, `${i}.json`);
        const data = structuredClone(doc.json);
        data.skeleton ??= {};
        data.skeleton.fps = fps;
        data.skeleton.images ??= "";
        data.skeleton.audio ??= "";
        writeJsonFile(input, data);
        await cliExecutor.exec({ args: context.adapter.cli.importArgs(input, stage, doc.name) });
        if (!fs.existsSync(stage)) throw new SpineError(ErrorCode.CLI_EXEC_FAILED, "重建未生成 .spine 文件。");
      }
      const verified = await exportProjectDocuments(stage, path.join(tempDir, "verify"));
      if (verified.fps !== fps || verified.documents.length !== documents.length) {
        throw new SpineError(ErrorCode.REBUILD_VALIDATION,
          `重建后的帧率或骨架数量不一致（帧率 ${fps} → ${verified.fps}，骨架 ${documents.length} → ${verified.documents.length}），原工程未替换。`);
      }
      for (const doc of documents) verifyRebuiltSkeleton(doc.json, selectSkeleton(verified.documents, doc.name).json);
      assertProjectUnchanged(projectPath, expectedHash);
      if (expectedHash !== null) result.backupPath = backupFile(projectPath);
      fs.renameSync(stage, projectPath);
      result.verified = true;
      return result;
    } finally {
      if (fs.existsSync(stage)) fs.unlinkSync(stage);
      removeDir(tempDir);
    }
  }, expectedHash === null ? documents[0].json?.skeleton?.spine ?? "3.8" : undefined);
}

/** 所有常规编辑共享一个导出、修改、验证、重建事务。 */
export async function editProject(
  projectPath: string, edit: (json: any) => unknown, skeletonName?: string, dryRun = false, capability: Capability = "legacy.edit"
): Promise<RebuildResult> {
  const project = fs.realpathSync(projectPath);
  return withProjectLock(project, () => withProjectContext(project, capability, async () => {
    const originalHash = projectHash(project);
    const temp = createTempDir("spine-edit-");
    try {
      const { documents, fps } = await exportProjectDocuments(project, temp);
      const target = selectSkeleton(documents, skeletonName);
      await edit(target.json);
      return await rebuildDocuments(project, documents, fps, originalHash, target.name, dryRun);
    } finally { removeDir(temp); }
  }));
}

export async function createProjectFromJson(projectPath: string, json: any, skeletonName: string): Promise<RebuildResult> {
  const project = path.resolve(projectPath);
  return withProjectLock(project, async () => {
    if (fs.existsSync(project)) throw new SpineError(ErrorCode.PROJECT_CHANGED, `目标已存在：${project}`);
    return rebuildDocuments(project, [{ name: skeletonName, json }], json.skeleton?.fps ?? 30, null, skeletonName);
  });
}
