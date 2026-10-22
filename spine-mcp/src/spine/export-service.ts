/**
 * 导出服务：生成导出设置 JSON 并调用 CLI 导出。
 * 关键点（已实测）：`-e` 接收的是导出设置 JSON 文件，而非直接输出路径。
 */
import * as fs from "fs";
import * as path from "path";
import { cliExecutor } from "./cli-executor";
import { ExportOptions } from "../types";
import { ensureDir, createTempDir, removeDir } from "../utils/file-utils";

import { currentProjectContext } from "./execution-context";
import { requireAdapter } from "./adapters/registry";
import { withProjectContext } from "./project-context";

export function generateExportSettings(options: ExportOptions): Record<string, any> {
  return (currentProjectContext()?.adapter ?? requireAdapter("3.8", "project.export")).cli.exportSettings(options);
}

/**
 * 执行导出。
 * @param projectPath  .spine 项目路径
 * @param outputDir    输出目录（不存在则创建）
 * @param options      导出选项
 * @returns 输出目录中生成的文件绝对路径列表
 */
export async function exportProject(projectPath: string, outputDir: string, options: ExportOptions): Promise<string[]> {
  return withProjectContext(projectPath, "project.export", async () => {
    ensureDir(outputDir);
    const settings = generateExportSettings(options);

    // 导出设置写入临时文件
    const tempDir = createTempDir("spine-export-");
    const settingsPath = path.join(tempDir, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify(settings), "utf8");

    try {
      await cliExecutor.exec({ args: ["-i", projectPath, "-o", outputDir, "-e", settingsPath] });
      // 收集输出目录中新增的文件
      const collect = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(f => {
        const file = path.join(dir, f.name);
        return f.isDirectory() ? collect(file) : [file];
      });
      return collect(outputDir);
    } finally {
      removeDir(tempDir);
    }
  });
}

/** 便捷：导出 JSON */
export function exportJson(projectPath: string, outputDir: string): Promise<string[]> {
  return exportProject(projectPath, outputDir, { format: "json" });
}

/** 便捷：导出二进制 */
export function exportBinary(projectPath: string, outputDir: string): Promise<string[]> {
  return exportProject(projectPath, outputDir, { format: "binary" });
}
