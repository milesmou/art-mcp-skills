/**
 * 工具：spine_set_curve — 设置关键帧插值曲线
 */
import { z } from "zod";
import { BaseTool } from "./base.tool";
import { editProject } from "../spine/rebuild-service";
import { failEdit } from "../spine/mesh-edit-service";

export class SetCurveTool extends BaseTool {
  name = "spine_set_curve";
  description = "批量设置关键帧插值曲线：linear/stepped/bezier（需四个控制点）。timeline 支持旧点分路径或分段数组，如 ['deform','default','衣服','衣服']，可处理含点号的名称。keyframeIndex 或 keyframeIndices 选择帧。";
  inputSchema = z.object({
    projectPath: z.string(),
    skeletonName: z.string().optional(),
    dryRun: z.boolean().default(false),
    animationName: z.string(),
    timeline: z.union([z.string(), z.array(z.string().min(1)).min(1)]).describe("时间轴路径，推荐分段数组"),
    keyframeIndex: z.number().int().min(0).optional(),
    keyframeIndices: z.array(z.number().int().nonnegative()).min(1).optional(),
    curve: z.enum(["linear", "stepped", "bezier"]).default("linear"),
    c1x: z.number().min(0).max(1).optional(),
    c1y: z.number().optional(),
    c2x: z.number().min(0).max(1).optional(),
    c2y: z.number().optional(),
  });

  async run(args: any): Promise<any> {
    const { projectPath, animationName, timeline, curve } = args;
    if ((args.keyframeIndex !== undefined) === !!args.keyframeIndices) failEdit("keyframeIndex/keyframeIndices 必须且只能提供一个");
    const indices: number[] = args.keyframeIndices ?? [args.keyframeIndex];
    if (new Set(indices).size !== indices.length) failEdit("关键帧索引重复");
    if (curve === "bezier" && [args.c1x, args.c1y, args.c2x, args.c2y].some(v => !Number.isFinite(v))) failEdit("bezier 需要全部四个控制点");
    const result = await editProject(projectPath, json => {
      let parts: string[] = Array.isArray(timeline) ? timeline : timeline.split(".");
      if (typeof timeline === "string" && ["bones", "slots"].includes(parts[0]) && parts.length > 3) parts = [parts[0], parts.slice(1, -1).join("."), parts.at(-1)!];
      if (parts.some(p => ["__proto__", "constructor", "prototype"].includes(p))) failEdit("无效时间轴路径");
      if (["events", "drawOrder"].includes(parts[0]) || (parts[0] === "slots" && parts.at(-1) === "attachment")) failEdit("此时间轴不支持插值曲线");
      let frames: any = json.animations?.[animationName];
      for (const part of parts) frames = frames?.[part];
      if (!Array.isArray(frames)) failEdit("时间轴不存在");
      for (const index of indices) {
        const frame = frames[index]; if (!frame) failEdit(`关键帧索引越界：${index}`);
        for (const key of ["curve", "c2", "c3", "c4"]) delete frame[key];
        if (curve === "stepped") frame.curve = "stepped";
        if (curve === "bezier") Object.assign(frame, { curve: args.c1x, c2: args.c1y, c3: args.c2x, c4: args.c2y });
      }
    }, args.skeletonName, args.dryRun);
    return { success: true, message: args.dryRun ? "曲线编辑校验通过（未写入）" : `已设置 ${indices.length} 个关键帧曲线`, data: { ...result, animationName, timeline, keyframeIndices: indices, curve } };
  }
}
