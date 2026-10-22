# 官方图集打包、自动网格与自动权重

Spine 3.8 新增三个工具，总计 85 个。`spine_repack_atlas` 保留原有简单打包行为；`spine_pack_atlas` 调用官方 CLI。网格和权重工具使用现有工程事务：排他锁、自动备份、原文件变化检查、重建和回读校验。多骨架工程提供 `skeletonName`。

## 安装

```sh
npm install
npm run build
# 自动网格只需要 npm 依赖；自动权重另外需要 Python 3.10+：
npm run setup:external
```

安装脚本在包根目录创建独立 `.venv-external`，安装 `scripts/external-tools/requirements.txt`（libigl 2.6.3、NumPy、SciPy）。不会更改系统 Python 包。已经部署好依赖时，可以把 `SPINE_TOOLS_PYTHON` 设置为该 Python 可执行文件的绝对路径；该设置优先于项目内虚拟环境。Python 必须有对应平台的 libigl wheel，或自行完成原生编译。本机验证使用 Windows / Python 3.12。

构建后重启 MCP 服务以发现三个新工具。CLI 仍由 `SPINE_EXE` 和 `SPINE_VERSION` 配置；4.2 适配器仍未开放。自动权重使用真实 libigl BBW，没有依赖时返回明确错误，不会退化为距离权重。求解默认最长 120 秒，可通过 `SPINE_TOOLS_TIMEOUT_MS` 调整；超时或失败时不提交工程。

## 官方图集打包：spine_pack_atlas

```json
{
  "inputDir": "D:/art/hero/images",
  "outputDir": "D:/art/hero/packed-new",
  "atlasName": "hero",
  "settings": {
    "maxWidth": 1024,
    "maxHeight": 1024,
    "rotation": true,
    "paddingX": 2,
    "paddingY": 2,
    "premultiplyAlpha": true,
    "stripWhitespaceX": true,
    "stripWhitespaceY": true
  }
}
```

也可提供 `packSettingsPath`，读取编辑器保存的原生打包设置 JSON；与 `settings` 二选一。设置字段及兼容性取决于所选 3.8 编辑器补丁；CLI 不支持的设置会直接报错。可选 `projectPath` 通过 `-j` 提供 mesh 裁边上下文，并固定工程所用编辑器版本。

工具固定生成 PNG 和 `.atlas`，在临时目录完成打包，校验所有 atlas 页面引用和图片尺寸后发布到 `outputDir`。输出目录必须不存在或为空，不覆盖已有资源。返回 `atlasPaths`、`pages` 和完整 `files`，支持多页面及子目录图集。

## 自动网格：spine_generate_mesh

```json
{
  "projectPath": "D:/art/hero/hero.spine",
  "slotName": "cape",
  "attachmentName": "cape",
  "imagePath": "D:/art/hero/images/cape.png",
  "mode": "trace",
  "spacing": 16,
  "simplify": 2,
  "dryRun": true
}
```

`imagePath` 为该附件的原始未裁剪部件图片，不能传 atlas 页面；其 UV 必须对应完整图片。工具不会替换或复制纹理文件。

- `mode=trace`：按 Alpha 提取像素边界，简化轮廓并生成内部采样点；`grid` 使用完整图片矩形。
- `alphaThreshold` 默认 16，只将大于阈值的像素视为不透明。
- `simplify` 是像素轮廓简化容差，默认 2；0 保留轮廓转折。
- `spacing` 是内部采样间距，默认 16；越小网格越密。最多 4096 顶点，默认 `maxVertices=2048`，图片最多 4194304 像素。
- `cdt2d` 执行约束 Delaunay 三角剖分，生成 UV、边界和三角形。输出保持 region 的位移、旋转、缩放与尺寸，保留贴图路径和颜色。
- 多个独立不透明区域默认拒绝。只有显式 `islandMode=largest` 才选择面积最大的外轮廓，并返回区域数量。透明孔洞不生成几何孔，仍由纹理透明显示；返回 `filledHoles`。
- 已有网格需 `replaceExisting=true`，将替换拓扑和原权重。通过旧网格 UV 的重心插值保持 setup 外形；超出旧网格覆盖范围会拒绝。
- 已有 FFD 默认拒绝；`deformPolicy=clear` 显式清除该附件所有动画中的 FFD。存在关联网格时拒绝重建拓扑。

`dryRun=true` 真实计算网格并校验数据，但不执行 CLI 重建或写入工程；默认 false 时自动备份并验证回读结果。

## 自动权重：spine_auto_weights

```json
{
  "projectPath": "D:/art/hero/hero.spine",
  "slotName": "cape",
  "attachmentName": "cape",
  "bones": ["spine", "cape-left", "cape-right"],
  "maxInfluences": 4,
  "threshold": 0.001,
  "pins": [{ "vertexIndex": 0, "boneName": "spine" }],
  "dryRun": true
}
```

只支持独立 mesh。`bones` 指定参与骨骼，最多 64 根，数量不能超过顶点数；网格最多 4096 顶点，不能含退化三角形或未使用顶点。按照 setup 世界坐标求解后，转回每根骨骼的绑定坐标，保持 setup 外形。该工具计算所有顶点的权重。

自动选取骨骼附近的不同顶点作为约束，并覆盖每个网格连通分量。`pins` 可以显式固定顶点为指定骨骼的 100% 权重，其骨骼必须包含在 `bones` 中。调用 libigl 的有界双调和权重求解，再按 `threshold`、`maxInfluences` 剪枝并归一化。返回实际约束点，便于检查或复用。

这是基于网格形状和指定骨骼的自动求解，种子顶点选择及结果不保证与 Spine 编辑器 Auto 相同；粗网格和相近骨骼建议提供 `pins`。没有求解成功时不会返回距离算法的替代结果。

已有 FFD 和关联网格遵循同样的拒绝/显式清除规则。`dryRun` 会调用外部求解器并校验数据，但不提交工程；它不能证明实际 CLI 导入已成功。

## 验证

```sh
npm test
npm run setup:external
npm run test:external
npm run test:rebuild
```

`npm test` 包含轮廓凹陷、独立区域、孔洞、顶点预算、坐标转换、异常权重、依赖保护、图集多页和失败时保留原输出的测试。`test:external` 真实运行 libigl BBW；存在 Spine CLI 时还验证网格/权重的工程重建、dryRun 不写入和官方多页打包。

依赖和接口参考：[Spine CLI](https://en.esotericsoftware.com/spine-command-line-interface)、[cdt2d](https://github.com/mikolalysenko/cdt2d)、[libigl BBW](https://libigl.github.io/tutorial/#bounded-biharmonic-weights)。
