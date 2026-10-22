/**
 * 工具基类：统一错误捕获 → ToolResult 结构
 */
import { z } from "zod";
import { ToolResult } from "../types";
import { toSpineError } from "../utils/error-codes";
import { REBUILD_NOTICE } from "../spine/rebuild-service";
import * as fs from "fs";
import { withProjectContext } from "../spine/project-context";
import { toolCapability } from "./tool-capability";

/** 工具定义接口 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (args: any) => Promise<ToolResult>;
}

export abstract class BaseTool implements ToolDefinition {
  abstract name: string;
  abstract description: string;
  abstract inputSchema: z.ZodTypeAny;

  /** 具体执行逻辑（抛错即可，execute 会统一捕获） */
  protected abstract run(args: any): Promise<ToolResult>;

  /** 统一入口：捕获异常 → 返回友好 ToolResult */
  async execute(args: any): Promise<ToolResult> {
    try {
      const parsed = this.inputSchema.safeParse(args ?? {});
      if (!parsed.success) {
        return { success: false, message: `参数校验失败：${parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("；")}`, errorCode: "E_INVALID_ARGUMENT" };
      }
      const input = parsed.data as any;
      const projectPath = input?.skeletonJson ?? input?.projectPath;
      const contextRequired = typeof projectPath === "string" && fs.existsSync(projectPath)
        && this.name !== "spine_rollback" && this.name !== "spine_get_capabilities";
      const result = await (contextRequired
        ? withProjectContext(projectPath, toolCapability(this.name), () => this.run(input)) : this.run(input));
      if (result.success && result.data?.backupPath && this.name !== "spine_rollback" && this.name !== "spine_clean_animation") {
        result.warning = [result.warning, REBUILD_NOTICE].filter((v, i, values) => v && values.indexOf(v) === i).join("\n");
      }
      return result;
    } catch (err) {
      const e = toSpineError(err);
      return {
        success: false,
        message: e.message,
        errorCode: e.code,
        data: { suggestion: e.suggestion },
      };
    }
  }
}
