/**
 * 工具：spine_rollback — 列出备份 / 一键回滚
 */
import { z } from "zod";
import { BaseTool } from "./base.tool";
import { listBackups, backupFile } from "../utils/file-utils";
import { withProjectLock } from "../spine/project-lock";
import { randomUUID } from "crypto";
import { ErrorCode, SpineError } from "../utils/error-codes";
import * as fs from "fs";
import * as path from "path";

export class RollbackTool extends BaseTool {
  name = "spine_rollback";
  description = "列出某项目全部历史备份；传入 backupId 则回滚到该备份（保留最近 10 次）。每次修改工具都自动备份，出错可用此工具恢复。";
  inputSchema = z.object({
    projectPath: z.string(),
    backupId: z.string().optional().describe("备份文件名（不填则只列出备份）"),
  });

  async run(args: { projectPath: string; backupId?: string }): Promise<any> {
    const backups = listBackups(args.projectPath);
    if (!args.backupId) {
      return { success: true, message: `找到 ${backups.length} 个备份`, data: { backups } };
    }
    if (!backups.includes(args.backupId) || path.basename(args.backupId) !== args.backupId) {
      throw new SpineError(ErrorCode.INVALID_ARGUMENT, `备份不存在：${args.backupId}`, "可用 spine_rollback 列出全部备份。");
    }
    const project = fs.realpathSync(args.projectPath);
    return withProjectLock(project, async () => {
      const content = fs.readFileSync(path.join(path.dirname(project), args.backupId!));
      const backupPath = backupFile(project);
      const stage = path.join(path.dirname(project), `.spine-rollback-${randomUUID()}.spine`);
      try { fs.writeFileSync(stage, content, { flag: "wx" }); fs.renameSync(stage, project); }
      finally { if (fs.existsSync(stage)) fs.unlinkSync(stage); }
      return { success: true, message: `已回滚到备份 ${args.backupId}`, data: { restored: args.backupId, backupPath } };
    });
  }
}
