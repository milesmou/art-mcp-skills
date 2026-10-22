import { z } from "zod";
import * as path from "path";
import { BaseTool } from "./base.tool";
import { editProject } from "../spine/rebuild-service";
import { readJsonForExport } from "../spine/modify-service";
import { readJsonFile } from "../utils/file-utils";
import { inspectMesh, editWeights, deformMesh } from "../spine/mesh-edit-service";
import { clothMotion } from "../spine/cloth-motion-service";
import { editEvents, animationRange, manageAttachment } from "../spine/daily-edit-service";
import { toolCapability } from "./tool-capability";

const project = { projectPath: z.string().min(1), skeletonName: z.string().min(1).optional(), dryRun: z.boolean().default(false) };
const target = { skinName: z.string().min(1).default("default"), slotName: z.string().min(1), attachmentName: z.string().min(1) };
const indices = z.array(z.number().int().nonnegative()).min(1);

abstract class DailyMutationTool extends BaseTool {
  protected abstract apply(json: any, args: any): any;
  async run(args: any): Promise<any> {
    let detail: any;
    const result = await editProject(args.projectPath, json => { detail = this.apply(json, args); }, args.skeletonName, args.dryRun, toolCapability(this.name));
    return { success: true, message: args.dryRun ? "编辑数据校验通过（未写入）" : "编辑已完成，工程已备份并回读校验", data: { ...result, ...detail } };
  }
}

export class GetMeshTool extends BaseTool {
  name = "spine_get_mesh";
  description = "读取网格逻辑顶点索引、UV、三角形、世界坐标和逐顶点骨骼权重。支持普通/加权 mesh；可在动画指定秒数采样，供选择固定点、形变和权重编辑。只读。";
  inputSchema = z.object({ projectPath: project.projectPath, skeletonName: project.skeletonName, ...target,
    animationName: z.string().optional(), time: z.number().nonnegative().default(0) });
  async run(args: any): Promise<any> {
    const json = path.extname(args.projectPath).toLowerCase() === ".json" ? readJsonFile(args.projectPath) : await readJsonForExport(args.projectPath, args.skeletonName);
    return { success: true, message: "网格顶点及权重已读取", data: inspectMesh(json, args, args.animationName, args.time) };
  }
}
export class EditWeightsTool extends DailyMutationTool {
  name = "spine_edit_weights";
  description = "按逻辑顶点设置骨骼权重、归一化、移除小权重或按相邻网格平滑。保持 setup 世界外形；普通网格可绑定为加权网格。已有 FFD 时默认拒绝，显式 deformPolicy=clear 才清除该附件所有动画形变；关联网格暂拒绝。";
  inputSchema = z.object({ ...project, ...target, action: z.enum(["set", "normalize", "prune", "smooth"]),
    vertexIndices: indices.optional().describe("省略表示全部顶点"),
    influences: z.array(z.object({ boneName: z.string().min(1), weight: z.number().nonnegative() })).min(1).optional(),
    threshold: z.number().min(0).max(1).default(0.01), strength: z.number().min(0).max(1).default(0.5),
    deformPolicy: z.enum(["reject", "clear"]).default("reject") });
  apply(json: any, args: any): any { return editWeights(json, args, args); }
}
export class DeformMeshTool extends DailyMutationTool {
  name = "spine_deform_mesh";
  description = "批量写普通/加权网格 FFD。frames 每帧 offsets 为每个逻辑顶点一对 x/y 位移（共 vertexCount*2），自动转换骨骼影响坐标。space=world/slot；mode=add 叠加已有形变，replace 替换指定时刻。time 单位秒。";
  inputSchema = z.object({ ...project, ...target, animationName: z.string().min(1),
    space: z.enum(["world", "slot"]).default("world"), mode: z.enum(["replace", "add"]).default("replace"),
    frames: z.array(z.object({ time: z.number().nonnegative(), offsets: z.array(z.number()).min(2) })).min(1).max(1801) });
  apply(json: any, args: any): any { return deformMesh(json, args, args); }
}
export class ClothMotionTool extends DailyMutationTool {
  name = "spine_cloth_motion";
  description = "给已有动画烘焙衣摆/袖口/披风的惯性跟随和回弹，支持普通及加权 mesh、多个附件、固定顶点。targets 可提供 vertexWeights=0..1 柔软程度；未提供时沿 slot 局部 y 渐变，默认 min 边缘最自由。循环动画自动收敛并检查网格翻折；不是碰撞/自碰撞物理模拟。";
  inputSchema = z.object({ ...project, animationName: z.string().min(1), targets: z.array(z.object({ ...target,
    vertexWeights: z.array(z.number().min(0).max(1)).min(1).optional(), pinnedVertices: indices.optional(),
    gradientAxis: z.enum(["x", "y"]).default("y"), freeEdge: z.enum(["min", "max"]).default("min") })).min(1).max(32),
    duration: z.number().positive().max(30).optional(), fps: z.number().int().min(2).max(60).default(30), loop: z.boolean().default(true),
    frequency: z.number().min(0.5).max(8).default(3.2), damping: z.number().min(0.2).max(1.5).default(0.75),
    strength: z.number().min(0).max(2).default(0.9), maxOffset: z.number().positive().max(100).default(10),
    replaceExisting: z.boolean().default(false).describe("已有形变时需显式设 true；在原形状上烘焙并替换目标轨道") });
  apply(json: any, args: any): any { return clothMotion(json, args.targets, args); }
}
export class EditEventsTool extends DailyMutationTool {
  name = "spine_edit_events";
  description = "一次事务批量管理事件：create/update/rename/delete 定义（含音频路径、音量、声道），keyframe_upsert/delete/shift 管理动画事件关键帧。重命名同步所有引用；删除被引用事件需要 cascade=true。时间单位秒，事件允许同一时刻触发多个不同事件。";
  inputSchema = z.object({ ...project, operations: z.array(z.object({
    action: z.enum(["create", "update", "rename", "delete", "keyframe_upsert", "keyframe_delete", "keyframe_shift"]),
    eventName: z.string().min(1), newName: z.string().min(1).optional(), animationName: z.string().min(1).optional(),
    int: z.number().int().optional(), float: z.number().optional(), string: z.string().optional(), audio: z.string().optional(),
    volume: z.number().nonnegative().optional(), balance: z.number().min(-1).max(1).optional(), cascade: z.boolean().default(false),
    time: z.number().nonnegative().optional(), startTime: z.number().nonnegative().optional(), endTime: z.number().nonnegative().optional(), offset: z.number().optional(),
  })).min(1).max(1000) });
  apply(json: any, args: any): any { return editEvents(json, args.operations); }
}
export class AnimationRangeTool extends DailyMutationTool {
  name = "spine_animation_range";
  description = "跨骨骼/插槽/FFD/约束/事件批量处理关键帧：copy 复制到同一或其他动画，shift 平移，scale 变速，reverse 反转（支持线性/贝塞尔，阶跃拒绝），delete 删除，quantize 对齐帧。只处理范围内已有关键帧，不自动补边界帧；冲突默认拒绝，可 collision=replace。";
  inputSchema = z.object({ ...project, animationName: z.string().min(1), action: z.enum(["copy", "shift", "scale", "reverse", "delete", "quantize"]),
    startTime: z.number().nonnegative().default(0), endTime: z.number().nonnegative().optional(),
    timelinePaths: z.array(z.array(z.string().min(1)).min(1)).min(1).optional(), targetAnimation: z.string().min(1).optional(),
    targetTime: z.number().nonnegative().optional(), offset: z.number().optional(), scale: z.number().positive().optional(),
    fps: z.number().positive().max(240).optional(), collision: z.enum(["reject", "replace"]).default("reject") });
  apply(json: any, args: any): any { return animationRange(json, args); }
}
export class ManageAttachmentTool extends DailyMutationTool {
  name = "spine_manage_attachment";
  description = "附件日常管理：rename 同步同一插槽各皮肤的同名附件、动画换图、FFD 及关联网格引用；duplicate 复制附件及形变到指定皮肤；convert_to_mesh 将 region 转为保持外形的四顶点网格，随后可添加 FFD。保留原贴图路径。";
  inputSchema = z.object({ ...project, ...target, action: z.enum(["rename", "duplicate", "convert_to_mesh"]),
    newName: z.string().min(1).optional(), targetSkinName: z.string().min(1).optional() });
  apply(json: any, args: any): any { return manageAttachment(json, args, args); }
}
