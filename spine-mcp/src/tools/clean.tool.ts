/**
 * 工具：spine_clean_animation — 清理未使用关键帧（CLI -m）
 */
import { z } from "zod";
import { BaseTool } from "./base.tool";
import { cleanProject } from "../spine/cleanup-service";
import { backupFile } from "../utils/file-utils";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { withProjectLock, projectHash, assertProjectUnchanged } from "../spine/project-lock";

export class CleanAnimationTool extends BaseTool {
  name = "spine_clean_animation";
  description = "清理项目中未使用的关键帧（对应 Spine CLI 的 -m），执行前自动备份。";
  inputSchema = z.object({
    projectPath: z.string(),
  });

  async run(args: { projectPath: string }): Promise<any> {
    const project = fs.realpathSync(args.projectPath);
    return withProjectLock(project, async () => {
      const originalHash = projectHash(project);
      const stage = path.join(path.dirname(project), `.spine-clean-${randomUUID()}.spine`);
      try {
        fs.copyFileSync(project, stage, fs.constants.COPYFILE_EXCL);
        const result = await cleanProject(stage);
        assertProjectUnchanged(project, originalHash);
        const backupPath = backupFile(project);
        fs.renameSync(stage, project);
        return {
          success: true,
          message: `清理完成：移除 ${result.removedKeys} 个未使用关键帧`,
          data: { skeletonName: result.skeletonName, removedKeys: result.removedKeys, backupPath },
        };
      } finally { if (fs.existsSync(stage)) fs.unlinkSync(stage); }
    });
  }
}
