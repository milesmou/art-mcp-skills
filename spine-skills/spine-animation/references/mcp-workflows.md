# MCP 操作工作流

以下短名对应当前会话实际暴露的 MCP 工具；使用前核对工具 schema。示例中的 `PROJECT_PATH`、`EXPORTED_JSON_PATH`、`VARIANT_JSON_PATH`、`ATLAS_PATH`、`ATLAS_PNG_PATH` 和 `OUTPUT_PNG_PATH` 都需替换为实际绝对路径。多骨架工程给支持该参数的编辑接口传入 `skeletonName`，不要默认修改第一个骨架。

## 读取与快照

按顺序调用能力查询和体检，再按任务读取细节：

```json
{"projectPath":"PROJECT_PATH"}
```

该参数对象可用于 `spine_get_capabilities`、`spine_check_project`、`spine_get_project_info`、`spine_describe`、`spine_list_animations`。体检后已有的信息无需逐个工具重复读取。

`spine_export_animation`：

```json
{"projectPath":"PROJECT_PATH","format":"json","outputDir":"EXPORT_DIRECTORY"}
```

以返回的文件列表为准；文件名来自骨架名，不一定来自 `.spine` 文件名。多个骨架分别保留，选择本次目标 JSON。

导出文件可交给 `scripts/inspect_spine_json.py` 汇总。脚本不启动 Spine；用 UTF-8 输出统计、附件备选、形变目标和动画时长。`--animation` 加入该动作的换图、绘制顺序及骨骼端点差异。输出用于定位，不替代 MCP 引用校验或运行时采样。

## 从现有动作派生

优先完整复制基线；例如同一女主工程中把 `idle` 改成更轻的呼吸，可在导出快照上生成候选 JSON：

```python
import copy
import json
from pathlib import Path

source_path = Path("EXPORTED_JSON_PATH")
variant_path = Path("VARIANT_JSON_PATH")
data = json.loads(source_path.read_text(encoding="utf-8-sig"))
variant = copy.deepcopy(data["animations"]["idle"])
frames = variant["bones"]["zheng"]["translate"]
matches = [f for f in frames if abs(f.get("time", 0) - 0.5) < 0.0002]
assert len(matches) == 1, "快照与参考结构不同，先重新检查时间轴"
matches[0]["y"] = -2.5  # 参考基线中该值为 -3.53；其他通道保留。
data["animations"]["idle_soft"] = variant
assert variant_path.resolve() != source_path.resolve()
variant_path.parent.mkdir(parents=True, exist_ok=True)
variant_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
```

这段代码只适用于已核对过的女主绑定；其他工程使用实际骨骼名和基线值。随后调用 `spine_edit_animation`：

```json
{
  "projectPath":"PROJECT_PATH",
  "skeletonName":"mainGirl1",
  "animationName":"idle_soft",
  "mode":"create",
  "jsonPath":"VARIANT_JSON_PATH",
  "sourceAnimation":"idle_soft",
  "dryRun":true
}
```

检查结果后以相同参数、`dryRun=false` 正式保存。已有同名新动作时明确选择修改哪个版本，避免重试意外覆盖。也可先 `spine_duplicate_animation({projectPath,sourceName,newName})`，再局部编辑，但会多一次后台重建。

对任意动作单轨补帧，`spine_edit_keyframes` 示例：

```json
{
  "projectPath":"PROJECT_PATH",
  "animationName":"idle_soft",
  "timeline":["bones","zheng","translate"],
  "operation":"upsert",
  "frames":[{"time":0.5,"y":-2.5}],
  "dryRun":true
}
```

确认该轨原有 x 值以及同时间帧合并语义，再写入。`replace` 替换整轨；`delete / shift` 的时间范围含两端。`spine_edit_animation(mode="merge")` 也会替换传入的整条数组，不能把一个关键帧数组当增量。

`spine_batch_edit` 的路径是 JSON Pointer，名称中的 `/` 转义为 `~1`、`~` 转义为 `~0`；数组索引先加 `test` 确认名称。所有操作在同一事务成功后才发布。

## 设计全新动作

1. 从目标动作最接近的基线开始，规划重心、支撑、主姿势和动作起落。循环时先定义一个周期；单次动作先定义预备、主动作和收势。
2. 骨骼动作可用 `spine_pose_to_animation` 表达 `{time,bones:{骨骼名:{rotation,x,y,scaleY}}}`；同一骨骼各姿势保持通道一致。此工具只生成骨骼运动，未提及通道按 setup 工作，不会自动继承原动作的换图、FFD、层次与约束。
3. `loop=true` 只补首姿势中骨骼的结束帧，仍需检查所有目标骨骼和其他轨道。该工具遇重名会另取后缀，使用返回的实际动画名。
4. 标准动作草稿可用 `spine_generate_animation`，`roleMap` 方向是 **骨骼名 → 角色**，例如 `{"z-shou1":"armL"}`。当前角色枚举从服务 schema/源码核对；模板中的假定骨骼轴向不保证适用于已有角色。
5. 用完整动画编辑工具补入所需附件、面部形变和绘制顺序。对参考女主，复用已有走跑通常比重新套模板更能保留 IK 与部件组合。

## 换图、隐藏与层次

- setup 默认附件使用 `spine_set_slot` / `spine_set_attachment`；它们不等同于动画中的换图。
- 动画换图用 `spine_control_slot`，或批量写 `['slots',slotName,'attachment']`。工具隐藏参数按 schema；原生关键帧用 `{"time":0,"name":null}` 隐藏，显示时写实际附件名。
- `spine_control_slot` 等使用 `frameIndex` 的接口按工程 FPS 换算；优先使用秒制批量接口避免帧率歧义。
- `spine_set_draw_order` 输入完整插槽顺序，按背面到正面列出，先从当前 `slots` 和既有动画计算。原生 JSON `drawOrder[].offsets` 是相对于 setup 顺序的偏移，不能用骨骼名或只列改变的插槽替代工具所需的完整列表。
- 本工程无事件。新增脚步、命中等业务触发时用 `spine_edit_events` 或 `spine_add_event_keyframe`，明确事件名和秒数；视觉效果的附件切换不自动构成游戏事件。

## 网格、权重与衣料

1. 先调用 `spine_get_mesh({projectPath,skinName,slotName,attachmentName,animationName,time})`。从返回的逻辑顶点、世界位置、权重选择固定点，不假设顶点 0、1 就是腰口或袖口。
2. 直接 FFD 优先 `spine_deform_mesh`；`frames[].offsets` 必须为逻辑顶点数 × 2。`space="world"` / `"slot"` 决定位移方向，`mode="add"` 叠加已有形变，`replace` 替换指定时刻。不要把此格式直接塞进加权网格的原生 `deform.vertices`。
3. 周期飘动用 `spine_mesh_wave`，已有动作明确使用 `mode="add"` 或 `"replace"`；`mode="create"` 用于创建新动作。保持发根、腰线和袖根稳定。
4. 惯性跟随用 `spine_cloth_motion`，结合插槽局部方向选择 `gradientAxis` 和 `freeEdge`，或显式给 `vertexWeights`（0 固定，1 最柔软）。先限制 `maxOffset` 并 dry-run。参考女主裙摆已有多骨骼权重，先看原动画效果再决定是否增加 FFD。
5. `spine_cloth_motion` 默认循环，单次动作设 `loop=false`；已有形变需要明确 `replaceExisting=true` 才允许替换。重复运行会再次累加，调参从同一源副本或备份开始。它不提供碰撞或自碰撞。
6. 改拓扑用 `spine_generate_mesh` / `spine_edit_mesh`，改绑定用 `spine_edit_weights`；自动权重 `spine_auto_weights` 还依赖服务端已安装的 libigl BBW 求解器（服务仓库的 `npm run setup:external`）。缺少求解器时报告该条件，不把普通归一化称为自动绑定。
7. `deformPolicy="clear"` 会清除该附件在所有动画里的 FFD，关联/链接网格还有额外限制。只有任务确需重绑且已安排恢复形变时才使用；先在副本试做。

## 从拆分贴图建工程

已有 `.spine` 绑定时直接复用，不重新装配。只有用户提供贴图且需要新角色时走以下流程：

- 一张透明 PNG 中的互不重叠散件：`spine_cut_parts` 生成部件、`partsMeta.json` 与蒙太奇；查看蒙太奇后记录每个部件的语义和前后层次。
- `spine_assemble` 使用索引 `{"parts":{"part-N":{"name":"部件名","parent":"父级名","x":0,"y":0,"pivotX":0,"pivotY":0,"order":0}}}`；索引坐标、单位和父级关系按当前服务返回格式及 schema 核对，示例中的零不代表实际安装位置。
- 独立 PNG 目录用 `spine_build_skeleton(partsDir,outputJsonPath,...)`；当前工具没有 `partsIndexPath` 参数，而是自动读取 `partsDir/partsIndex.json`，格式为 `{"PNG文件名不含扩展名":{"bone":"骨骼名","x":0,"y":0}}`。这个格式不同于 `spine_assemble` 的索引；生成骨骼默认都挂在 root 下，还需整理父子关系。完全重叠的完整人物立绘不能靠连通域切出被遮挡肢体；缺少拆件时明确所缺素材。
- 先验证 setup 拼接外形、关节枢轴、draw order、缩放和图片路径，再建立网格/权重、约束和动作。空工程从 `spine_create_project` 起步。`spine_pipeline` 仅在输入符合要求且需要预设动作全流程时采用。
- atlas 优先官方 `spine_pack_atlas`，输出目录必须不存在或为空。按目标运行时核对 PMA、旋转、裁边和多页设置，不把默认打包参数视为项目约定。

## 预览、导出与恢复

`spine_render_preview` 使用当前导出 JSON，显式指定图集：

```json
{
  "skeletonJson":"EXPORTED_JSON_PATH",
  "atlasPath":"ATLAS_PATH",
  "imagePath":"ATLAS_PNG_PATH",
  "animationName":"idle_soft",
  "mode":"sequence",
  "frames":8,
  "spriteColumns":4,
  "width":320,
  "height":420,
  "outputPath":"OUTPUT_PNG_PATH"
}
```

当前源码实际要求 atlas 和图片；工具描述中的无图集回退不能作为可用保证。官方 runtime 采样/渲染不可用时可能回退，检查返回 `renderer` 和图像本身。参考工程没有导出宽高元数据，显式尺寸可避免默认 256 导致预览过小。

sequence 的 n 帧取样为 `duration*i/n`，不含精确终点。循环另外检查 `0`、`duration-ε`、`duration`；注意渲染器可能在 duration 时自动循环，原始端点和非循环播放也需检查。`spine_render_preview` 单帧的 `frameIndex/fps` 默认换算与工程 FPS 查询不是同一条路径，优先显式 `time`。

静态序列看姿势与层次，连续播放看速度、滞后、接缝；需要时用 `spine_export_video` 导出 GIF，或 `spine_export_sheet` 生成精灵表与元数据。MP4/WebM 需要服务端 ffmpeg。

修改后运行 `spine_validate_references` 并回读。运行时交付再调用 `spine_export_animation(format="json"|"binary")`，确认目标运行时支持同系列数据版本；atlas 的每个 page 名必须与图片实际文件匹配。贴图或 region 发生变化时重新打包，单改骨骼动画不需要无条件重打包。

失败时先读取具体错误、原文件是否保留、备份路径和源文件是否被外部改变。`spine_rollback({projectPath})` 只列备份；传 `backupId` 才执行恢复。备份保留数量有限，恢复前确认不会丢掉后续有效修改；不要将回滚作为盲目重试步骤。

本页参数依据项目根目录下 `spine-mcp-server/` 0.1.1 的工具 schema、`spine-mcp-server/docs/HEADLESS_EDITING.md`、`spine-mcp-server/docs/DAILY_OPERATIONS.md` 与预览源码核对。升级后以实际连接工具返回为准。
