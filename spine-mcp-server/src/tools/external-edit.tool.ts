import { z } from "zod";
import { BaseTool } from "./base.tool";
import { editProject } from "../spine/rebuild-service";
import { packOfficialAtlas } from "../spine/official-pack-service";
import { generateMesh } from "../spine/auto-mesh-service";
import { autoWeights } from "../spine/auto-weights-service";

const project = { projectPath: z.string().min(1), skeletonName: z.string().min(1).optional(), dryRun: z.boolean().default(false) };
const target = { skinName: z.string().min(1).default("default"), slotName: z.string().min(1), attachmentName: z.string().min(1) };
export class PackAtlasTool extends BaseTool {
  name = "spine_pack_atlas";
  description = "使用官方 Spine CLI 打包图集，支持旋转、多页、尺寸、间距、预乘 Alpha 等设置。settings 为原生打包设置，或传 packSettingsPath；固定输出 PNG/.atlas。outputDir 必须不存在或为空，输出验证成功后才发布。可选 projectPath 提供 mesh 裁边上下文。";
  inputSchema = z.object({ inputDir: z.string().min(1), outputDir: z.string().min(1), atlasName: z.string().min(1).default("atlas"),
    projectPath: z.string().min(1).optional(), packSettingsPath: z.string().min(1).optional(), settings: z.record(z.string(), z.unknown()).optional() })
    .refine(v => !(v.packSettingsPath && v.settings), "packSettingsPath 与 settings 只能提供一个");
  async run(args: any): Promise<any> { return { success: true, message: "官方图集打包完成，页面已验证", data: await packOfficialAtlas(args) }; }
}
export class GenerateMeshTool extends BaseTool {
  name = "spine_generate_mesh";
  description = "从原始部件 PNG 自动生成网格：trace 按 Alpha 描边，grid 使用图片矩形；spacing 控制内部布点，cdt2d 做约束三角剖分。保持 region 变换/贴图路径。多个独立区域默认拒绝，可 islandMode=largest；透明孔洞填充三角形但仍由纹理透明显示。已有网格需 replaceExisting=true，已有 FFD 需 deformPolicy=clear，关联网格拒绝。支持 dryRun。";
  inputSchema = z.object({ ...project, ...target, imagePath: z.string().min(1), mode: z.enum(["trace", "grid"]).default("trace"),
    alphaThreshold: z.number().int().min(0).max(254).default(16), simplify: z.number().min(0).max(100).default(2),
    spacing: z.number().min(1).max(4096).default(16), maxVertices: z.number().int().min(3).max(4096).default(2048),
    islandMode: z.enum(["reject", "largest"]).default("reject"), replaceExisting: z.boolean().default(false), deformPolicy: z.enum(["reject", "clear"]).default("reject") });
  async run(args: any): Promise<any> {
    let detail: any;
    const result = await editProject(args.projectPath, async json => { detail = await generateMesh(json, args, args); }, args.skeletonName, args.dryRun, "mesh.generate");
    return { success: true, message: args.dryRun ? "自动网格计算及数据校验通过（未写入）" : "自动网格已生成并回读校验", data: { ...result, ...detail } };
  }
}
export class AutoWeightsTool extends BaseTool {
  name = "spine_auto_weights";
  description = "使用外部 libigl BBW 求解器自动计算网格骨骼权重（需 npm run setup:external）。bones 指定参与骨骼，自动选择骨骼附近的约束点，可通过 pins 固定顶点归属；保持 setup 世界外形，支持剪枝及最大影响数。最多 4096 顶点/64 骨骼。已有 FFD 需显式 deformPolicy=clear，关联网格拒绝。dryRun 会真实求解但不写工程。";
  inputSchema = z.object({ ...project, ...target, bones: z.array(z.string().min(1)).min(1).max(64),
    maxInfluences: z.number().int().min(1).max(64).default(4), threshold: z.number().min(0).max(1).default(0.001),
    pins: z.array(z.object({ vertexIndex: z.number().int().nonnegative(), boneName: z.string().min(1) })).max(4096).optional(),
    deformPolicy: z.enum(["reject", "clear"]).default("reject") });
  async run(args: any): Promise<any> {
    let detail: any;
    const result = await editProject(args.projectPath, async json => { detail = await autoWeights(json, args, args); }, args.skeletonName, args.dryRun, "mesh.autoWeights");
    return { success: true, message: args.dryRun ? "自动权重求解及数据校验通过（未写入）" : "自动权重已保存并回读校验", data: { ...result, ...detail } };
  }
}
