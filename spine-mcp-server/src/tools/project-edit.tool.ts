import { z } from "zod";
import * as fs from "fs";
import { BaseTool } from "./base.tool";
import { editProject, createProjectFromJson, REBUILD_NOTICE } from "../spine/rebuild-service";
import { applyJsonEdits, editAnimation, editKeyframes } from "../spine/edit-service";
import { readJsonFile } from "../utils/file-utils";
import { adapterForJson } from "../spine/project-context";

const project = {
  projectPath: z.string().min(1).describe("目标 .spine 工程绝对路径"),
  skeletonName: z.string().min(1).optional().describe("多骨架工程必填，其他骨架一起保留"),
  dryRun: z.boolean().default(false).describe("只校验修改，不写入工程"),
};

export class RebuildProjectTool extends BaseTool {
  name = "spine_rebuild_project";
  description = `从骨架 JSON 重建 .spine，或导出已有工程后直接重建。无需编辑器 UI；自动备份、排他锁、回读验证。${REBUILD_NOTICE}`;
  inputSchema = z.object({ ...project, jsonPath: z.string().optional().describe("可选，提供时替换指定骨架，未提供时重建现有全部骨架") });
  async run(args: any): Promise<any> {
    const json = args.jsonPath ? readJsonFile(args.jsonPath) : undefined;
    if (!fs.existsSync(args.projectPath)) {
      if (!json || !args.skeletonName) return { success: false, message: "创建工程需要 jsonPath 和 skeletonName", errorCode: "E_INVALID_ARGUMENT" };
      if (args.dryRun) { const { validateRebuildJson } = await import("../spine/rebuild-validation"); validateRebuildJson(json); return { success: true, message: "新工程数据校验通过（未写入）" }; }
      const result = await createProjectFromJson(args.projectPath, json, args.skeletonName);
      return { success: true, message: "工程已创建并回读校验", data: result, warning: REBUILD_NOTICE };
    }
    const result = await editProject(args.projectPath, target => {
      if (json) { for (const k of Object.keys(target)) delete target[k]; Object.assign(target, json); }
    }, args.skeletonName, args.dryRun, "project.rebuild");
    return { success: true, message: args.dryRun ? "重建数据校验通过（未写入）" : "工程已重建并回读校验", data: result, warning: REBUILD_NOTICE };
  }
}

export class EditAnimationTool extends BaseTool {
  name = "spine_edit_animation";
  description = "新增、替换或合并动画时间轴并后台重建 .spine。保留其他动画、附件和骨架；支持完整 bones/slots/deform/ik/transform/paths/events/drawOrder 数据。merge 按时间轴数组替换，create 防止覆盖。可传 animation 或 jsonPath+sourceAnimation。";
  inputSchema = z.object({ ...project,
    animationName: z.string().min(1), mode: z.enum(["create", "replace", "merge"]).default("create"),
    animation: z.record(z.string(), z.any()).optional().describe("单个 Spine 3.8 动画对象，如 {bones:{head:{rotate:[{angle:0},{time:1,angle:15}]}}}"),
    jsonPath: z.string().optional().describe("包含 animations 的骨架 JSON 文件，可用于导入生成的 dance 动画"),
    sourceAnimation: z.string().optional().describe("从 jsonPath 读取的动画名，默认 animationName"),
  });
  async run(args: any): Promise<any> {
    if ((args.animation !== undefined) === !!args.jsonPath) return { success: false, message: "animation 与 jsonPath 必须且只能提供一个", errorCode: "E_INVALID_ARGUMENT" };
    const source = args.jsonPath ? readJsonFile(args.jsonPath) : undefined;
    if (source) adapterForJson(source, "legacy.edit");
    const animation = args.animation ?? source.animations?.[args.sourceAnimation ?? args.animationName];
    const result = await editProject(args.projectPath, json => editAnimation(json, args.animationName, animation, args.mode, source?.events), args.skeletonName, args.dryRun);
    return { success: true, message: args.dryRun ? "动画编辑校验通过（未写入）" : `动画 "${args.animationName}" 已保存，工程重建并校验成功`, data: { ...result, animationName: args.animationName }, warning: REBUILD_NOTICE };
  }
}

export class BatchEditTool extends BaseTool {
  name = "spine_batch_edit";
  description = "在一次导出/重建事务中批量编辑骨骼、插槽、附件或动画。使用 JSON Pointer 路径和 add/replace/remove/copy/move/test；全部成功才提交，支持 dryRun。例：[{op:'replace',path:'/bones/1/rotation',value:15},{op:'add',path:'/animations/dance',value:{bones:{}}}]。键名中的 / 用 ~1、~ 用 ~0。";
  inputSchema = z.object({ ...project, operations: z.array(z.object({
    op: z.enum(["add", "replace", "remove", "copy", "move", "test"]), path: z.string().startsWith("/"),
    from: z.string().optional(), value: z.any().optional(),
  })).min(1).max(1000) });
  async run(args: any): Promise<any> {
    const result = await editProject(args.projectPath, json => {
      const changed = applyJsonEdits(json, args.operations);
      for (const key of Object.keys(json)) delete json[key]; Object.assign(json, changed);
    }, args.skeletonName, args.dryRun);
    return { success: true, message: args.dryRun ? "批量编辑校验通过（未写入）" : `已完成 ${args.operations.length} 项编辑并重建工程`, data: { ...result, operations: args.operations.length }, warning: REBUILD_NOTICE };
  }
}

export class EditKeyframesTool extends BaseTool {
  name = "spine_edit_keyframes";
  description = "批量写入/替换/删除/平移关键帧；一次后台重建完成。timeline 为分段路径数组，可包含带点号或斜杠的骨骼名，如 ['bones','head','rotate']、['deform','default','face','face']；time 单位秒，旋转/位移是相对 setup 的偏移，缩放是倍率。";
  inputSchema = z.object({ ...project, animationName: z.string().min(1), timeline: z.array(z.string().min(1)).min(1),
    operation: z.enum(["upsert", "replace", "delete", "shift"]).default("upsert"),
    frames: z.array(z.record(z.string(), z.any())).optional(),
    startTime: z.number().min(0).optional(), endTime: z.number().min(0).optional(), offset: z.number().optional(),
  });
  async run(args: any): Promise<any> {
    let affected = 0;
    const result = await editProject(args.projectPath, json => { affected = editKeyframes(json, args.animationName, args.timeline, args.operation, args); }, args.skeletonName, args.dryRun);
    return { success: true, message: args.dryRun ? "关键帧编辑校验通过（未写入）" : `已编辑 ${affected} 个关键帧并重建工程`, data: { ...result, affected }, warning: REBUILD_NOTICE };
  }
}
