/**
 * 工具：spine_import_animation — 导入修改后的 JSON 回项目
 */
import { z } from "zod";
import * as fs from "fs";
import { BaseTool } from "./base.tool";
import { importJsonInPlace, importJson } from "../spine/import-service";
import { editProject, REBUILD_NOTICE } from "../spine/rebuild-service";
import { editAnimation } from "../spine/edit-service";
import { readJsonFile } from "../utils/file-utils";
import { adapterForJson } from "../spine/project-context";

export class ImportAnimationTool extends BaseTool {
  name = "spine_import_animation";
  description = "通过后台重建将 JSON 导入 .spine：replace 替换指定骨架；update 仅合并选定动画并保留原骨架和其他动画。自动备份、回读验证，目标不存在时创建新项目。";
  inputSchema = z.object({
    projectPath: z.string().describe("目标 .spine 项目（不存在则创建）"),
    jsonPath: z.string().describe("要导入的 JSON 文件"),
    mergeMode: z.enum(["replace", "update"]).default("replace").describe("replace=替换指定骨架；update=按动画名称导入时间轴"),
    animationNames: z.array(z.string().min(1)).min(1).optional().describe("update 模式选择的动画，不填则导入 JSON 中全部动画"),
    overwrite: z.boolean().default(false).describe("update 模式允许替换同名动画，默认遇到同名报错"),
    skeletonName: z.string().optional().describe("骨架名（不填自动获取）"),
  });

  async run(args: any): Promise<any> {
    if (args.mergeMode === "update") {
      const source = readJsonFile(args.jsonPath);
      adapterForJson(source, "legacy.edit");
      const names: string[] = args.animationNames ?? Object.keys(source.animations ?? {});
      if (!names.length) return { success: false, message: "JSON 中没有可导入动画", errorCode: "E_INVALID_ARGUMENT" };
      const result = await editProject(args.projectPath, json => {
        for (const name of names) editAnimation(json, name, source.animations?.[name], args.overwrite && Object.hasOwn(json.animations ?? {}, name) ? "replace" : "create", source.events);
      }, args.skeletonName);
      return { success: true, message: `已导入 ${names.length} 个动画并重建工程`, data: { ...result, animations: names }, warning: REBUILD_NOTICE };
    }
    const targetExists = fs.existsSync(args.projectPath);
    const result = targetExists
      ? await importJsonInPlace(args.projectPath, args.jsonPath, args.skeletonName)
      : await importJson(args.projectPath, args.jsonPath, { skeletonName: args.skeletonName });
    return {
      success: true,
      message: `导入成功（骨架 ${result.skeletonName}，${targetExists ? "原地替换" : "创建新项目"}）`,
      data: result, warning: REBUILD_NOTICE,
    };
  }
}
