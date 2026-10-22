# 日常编辑操作

支持 Spine 3.8 系列。包含本页 7 个日常编辑入口及 3 个外部工具集成入口，共 85 个 MCP 工具。官方打包、自动网格和自动权重见 [外部工具文档](EXTERNAL_TOOLS.md)。

修改均走后台 JSON 重建，无需打开编辑器窗口。新增修改工具支持 `skeletonName` 和 `dryRun`，沿用备份、工程锁、外部修改检测和回读校验。`dryRun` 只验证数据，不执行实际 CLI 导入。

## 能力与入口

| 需求 | 工具 |
|---|---|
| 查看顶点编号、世界坐标、三角形及骨骼权重 | `spine_get_mesh` |
| 设置权重、绑定网格、归一化、清理小权重、平滑 | `spine_edit_weights` |
| 按逻辑顶点直接写普通/加权网格形变 | `spine_deform_mesh` |
| 衣摆、袖口、披风的惯性跟随与回弹 | `spine_cloth_motion` |
| 波动叠加到已有动画、固定或选择顶点 | `spine_mesh_wave`（增强） |
| 创建、更新、改名、删除事件，批量编辑事件关键帧 | `spine_edit_events` |
| 跨时间轴复制片段、平移、变速、反转、删除、对齐帧 | `spine_animation_range` |
| 附件改名、复制到皮肤、普通图片转网格 | `spine_manage_attachment` |
| 批量修改曲线，包括 FFD 和带点号的名称 | `spine_set_curve`（增强） |

以下示例中的 `projectPath` 替换为实际 `.spine` 路径。时间单位为秒，顶点编号从 0 开始。多骨架工程同时提供 `skeletonName`。

## 查看网格

调用 `spine_get_mesh`：

```json
{
  "projectPath": "D:/project/hero.spine",
  "slotName": "衣摆",
  "attachmentName": "衣摆",
  "animationName": "dance",
  "time": 0.5
}
```

返回逻辑顶点索引、世界坐标、UV、三角形、每项影响的骨骼名和权重。这里的逻辑顶点与加权网格内部的骨骼影响项不同，后面的接口会自动转换。

## 布料跟随

调用 `spine_cloth_motion`：

```json
{
  "projectPath": "D:/project/hero.spine",
  "animationName": "dance",
  "maxOffset": 6,
  "frequency": 3.2,
  "damping": 0.75,
  "targets": [
    {
      "slotName": "衣摆",
      "attachmentName": "衣摆",
      "gradientAxis": "y",
      "freeEdge": "min",
      "pinnedVertices": [0, 1]
    }
  ]
}
```

算法先采样原动画，再把带阻尼的跟随结果烘焙成 FFD。`frequency` 越高越紧跟，`damping` 控制回弹，`strength` 控制跟随强度，`maxOffset` 限制世界空间位移。

默认在插槽局部坐标中沿 y 轴渐变：`freeEdge=min` 表示较小 y 一侧自由度最高。袖子可改用 x 轴。也可以提供 `vertexWeights`：为每个逻辑顶点提供一个 0～1 的值，0 固定、1 最柔软；`pinnedVertices` 会再次将指定点固定。

默认 `loop=true`，要求原动画首尾闭环；非循环动作用 `loop=false`。循环效果会先预热到周期稳定状态。生成时检查翻折和严重压缩，失败不会写入工程。单次支持最多 30 秒，并限制采样规模。

已有同附件形变时默认拒绝覆盖。设 `replaceExisting=true` 后，会在原动画形状上计算跟随，并替换目标 FFD 轨道。重复执行会再次叠加效果，请从备份恢复或使用预期的源动画重新生成。

这是烘焙的跟随动画，不含碰撞、自碰撞或实时布料解算。复杂遮挡和美术效果仍需查看预览。

## 直接编辑 FFD

`spine_deform_mesh` 的 `frames` 每帧提供 `time` 和 `offsets`。例如四顶点网格：

```json
{
  "projectPath": "D:/project/hero.spine",
  "animationName": "dance",
  "slotName": "衣摆",
  "attachmentName": "衣摆",
  "space": "world",
  "mode": "add",
  "frames": [
    { "time": 0.5, "offsets": [0, 0, 0, 0, 3, -1, -2, -1] }
  ]
}
```

`offsets` 长度必须为逻辑顶点数 × 2。`space=world` 使用世界坐标方向；`slot` 使用该时刻插槽骨骼的局部方向。`mode=add` 在原形变上叠加，`replace` 替换给定时刻的形变，其他时刻保留。普通网格与加权网格都能使用，不必手工计算影响数组。

`spine_mesh_wave` 同样支持加权网格。`mode=create` 保持原来新建动画的行为；`add/replace` 修改 `animationName` 指定的已有动画。可提供 `vertexIndices` 和 `pinnedVertices`。

## 编辑权重

调用 `spine_edit_weights`：

```json
{
  "projectPath": "D:/project/hero.spine",
  "slotName": "衣摆",
  "attachmentName": "衣摆",
  "action": "set",
  "vertexIndices": [2, 3],
  "influences": [
    { "boneName": "腰部", "weight": 0.7 },
    { "boneName": "裙摆", "weight": 0.3 }
  ]
}
```

- `set`：设置所选点的骨骼影响，自动归一化；普通网格可据此变为加权网格。
- `normalize`：归一化。
- `prune`：移除低于 `threshold` 的影响，至少保留最大项。
- `smooth`：按相邻三角形顶点平滑，`strength` 为 0～1。

未传 `vertexIndices` 表示全部顶点。绑定坐标按 setup 世界位置重算，保持默认姿态外形；动画中的跟随关系会随新权重改变。

**已有 FFD 时默认拒绝编辑权重**，因为影响数组布局可能改变。只有显式提供 `deformPolicy="clear"` 才清除该附件在所有动画中的 FFD 后继续。存在关联网格时暂拒绝修改权重。此限制会返回明确错误，不会静默丢失形变。

## 事件定义和事件关键帧

调用 `spine_edit_events`，一次事务执行：

```json
{
  "projectPath": "D:/project/hero.spine",
  "operations": [
    { "action": "create", "eventName": "step", "int": 1, "audio": "step.wav", "volume": 0.8 },
    { "action": "keyframe_upsert", "eventName": "step", "animationName": "dance", "time": 0.5, "string": "left" },
    { "action": "rename", "eventName": "step", "newName": "footstep" }
  ]
}
```

定义还支持 `float`、`string`、`balance`。音频路径只写入数据，不会复制音频文件。`rename` 同步所有动画引用。`delete` 删除被引用定义时必须提供 `cascade=true`，会同步删除对应事件帧。

`keyframe_upsert` 按事件名和时间定位，`keyframe_delete` 按 `time` 或 `startTime/endTime` 删除，`keyframe_shift` 在范围内按 `offset` 秒移动。同一时刻不同事件可以共存。

## 动画片段与曲线

调用 `spine_animation_range`：

```json
{
  "projectPath": "D:/project/hero.spine",
  "animationName": "dance",
  "action": "copy",
  "startTime": 0,
  "endTime": 1,
  "targetAnimation": "dance_intro",
  "targetTime": 0
}
```

默认处理所有时间轴，包括事件、FFD 和约束；`timelinePaths` 可限定，例如 `[["bones", "head", "rotate"]]`。

其他操作：`shift` 配合 `offset`，`scale` 配合正数 `scale`，`reverse` 指定结束时间，`delete` 删除选中范围，`quantize` 配合 `fps` 对齐帧。冲突默认拒绝，`collision=replace` 允许替换；事件可同时发生。

范围包含端点。仅操作已有关键帧，不自动在截取边界补插值帧。反转支持线性和贝塞尔曲线，阶跃曲线需要先烘焙，当前会明确拒绝。

`spine_set_curve` 现在支持 `timeline` 分段数组和 `keyframeIndices` 批量设置，也保留旧 `keyframeIndex`。贝塞尔需要完整的 `c1x/c1y/c2x/c2y`；线性设置会清理旧曲线控制点。事件和换图等离散轨道不支持插值曲线。

## 附件管理

`spine_manage_attachment` 提供：

- `rename`：提供 `newName`，同步该插槽各皮肤的同名附件、setup 默认附件、动画换图、FFD 和关联网格引用，保留贴图路径。
- `duplicate`：提供 `newName`，可提供 `targetSkinName` 复制到已有皮肤，同时复制 FFD 轨道。
- `convert_to_mesh`：将 region 附件转换为四顶点网格，保留位置、旋转、缩放形成的外形与贴图。更细的网格拓扑仍需通过 `spine_edit_mesh` 提供顶点、UV 和三角形数据。

## 验证与边界

`npm test` 包含日常编辑、坐标转换、固定点、闭环、事件引用和片段冲突测试。`npm run test:rebuild` 增加真实 Spine CLI 的网格、权重、形变、事件音频、附件和片段重建测试。

当前仍不承诺编辑器全功能对等。编辑器文件夹、视图等未导出信息无法通过 JSON 完整保留；原始 `.spine` 备份可恢复这些信息。所有现有编辑边界见 [后台重建说明](HEADLESS_EDITING.md)。
