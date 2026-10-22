/**
 * 工具：spine_mesh_wave — 网格波动特效（FFD 正弦变形动画）
 */
import { z } from "zod";
import { BaseTool } from "./base.tool";
import { editProject } from "../spine/rebuild-service";
import { meshWave } from "../spine/mesh-wave-service";

export class MeshWaveTool extends BaseTool {
  name = "spine_mesh_wave";
  description =
    "给普通或加权网格生成 FFD 波动，支持选区/固定顶点。mode=create 新动画，add 叠加到已有动画，replace 替换指定时刻。示例：{ projectPath, slotName:\"cape\", attachmentName:\"cape\", animationName:\"dance\", mode:\"add\", amplitude:3 }。";
  inputSchema = z.object({
    projectPath: z.string().describe(".spine 项目路径"),
    skeletonName: z.string().optional(),
    skinName: z.string().default("default"),
    dryRun: z.boolean().default(false),
    mode: z.enum(["create", "add", "replace"]).default("create"),
    vertexIndices: z.array(z.number().int().nonnegative()).min(1).optional(),
    pinnedVertices: z.array(z.number().int().nonnegative()).min(1).optional(),
    slotName: z.string().describe("mesh 附件所在插槽"),
    attachmentName: z.string().describe("mesh 附件名"),
    animationName: z.string().optional().describe("生成的动画名（不填自动生成）"),
    duration: z.number().positive().max(30).optional().describe("动画时长（秒），默认 1.5"),
    amplitude: z.number().min(0).optional().describe("波动幅度（像素），默认 6"),
    wavelength: z.number().min(1).optional().describe("波长（像素），默认 48"),
    cycles: z.number().min(0.1).optional().describe("一个时长内的波动周期数，默认 1"),
    axis: z.enum(["x", "y"]).optional().describe("波动方向，默认 y"),
    phase: z.number().optional().describe("初始相位（弧度），默认 0"),
    fps: z.number().int().min(2).max(60).optional().describe("采样密度，默认 12"),
  });

  async run(args: any): Promise<any> {
    let gen: any = null;
    const result = await editProject(args.projectPath, (json) => {
      gen = meshWave(json, args.slotName, args.attachmentName, args);
    }, args.skeletonName, args.dryRun);
    return {
      success: true,
      message: args.dryRun ? "波动形变校验通过（未写入）" : `已生成波动动画 "${gen.animationName}"（${gen.vertexCount} 顶点 / ${gen.keyframes} 帧）`,
      data: { ...result, ...gen },
    };
  }
}
