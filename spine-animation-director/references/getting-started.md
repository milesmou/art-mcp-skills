# 安装与使用

`spine-animation-director` 统筹 PSD/单图到 Spine 动画的完整流程，依赖本仓库相邻的 `photoshop-skill` 和 `spine-skill`。它不内置新的绘图或动画服务。

设计从 [已验收动作参考](accepted-motion-library.md) 开始：先看匹配片段，再确定状态姿势、主要变化和时长；常驻 idle、情绪状态与偶发小动作按用途区分。预演优先使用真实参考和能表达主要关节/接触关系的代理图，不以整图扭动替代新手势或换重心。

## 安装

将这三个完整目录安装到同一个技能根目录，保留各自的 `modules/`、`references/`、脚本和资源。Codex 默认技能目录为 `~/.codex/skills/`，或使用实际配置的技能根；也可让安装入口链接到仓库目录，使文档随仓库更新。已有技能不要无备份覆盖。

```text
<skills-root>/
  spine-animation-director/
  photoshop-skill/
  spine-skill/
```

也可直接在本项目中指向 [技能入口](../SKILL.md) 使用。Photoshop 环境与 UXP 启动方式见 [Photoshop 安装说明](../../photoshop-skill/references/getting-started.md)，Spine MCP、版本与外部依赖见 [Spine 安装说明](../../spine-skill/references/getting-started.md)。生成式补图需要实际可用的图像编辑工具，缺少时仍可做方案、原图拆分及可信源恢复，不能宣称完成模型补绘。

## 调用示例

PSD 全流程：

```text
使用 $spine-animation-director，根据 D:/art/hero.psd 制作警觉待机和挥剑攻击。
先输出整段动作剧本、动作时间轴、制作规范，以及带切线/枢轴标注的切图补图蓝图和交互预览。
方案通过后继续完成切图、必要补图、Spine 绑定、动画与预览，保留源 PSD。
```

单图全流程：

```text
使用 $spine-animation-director，根据 D:/art/hero.png 制作开心挥手后回站姿的单次动画。
请按动作需要拆件，明确肩根、腋下和手掌是否需要补图，验收效果方案后完成动画。
```

只设计方案：

```text
使用 $spine-animation-director，查看 D:/art/hero.png，设计受击后恢复站姿的动作剧本、制作规范和切图补图蓝图，本次不执行制作。
```

按已验收库制作待机：

```text
使用 $spine-animation-director，根据 D:/art/hero.png 制作有角色性格的 idle。
参考我指定目录中已验收的 Spine，先说明采用的工程/动画、是常驻循环还是偶发小动作，
对照实际姿势、幅度和节奏，再规划需要的手势、袖型与补图区，预演通过后制作。
```

参考根目录优先使用当前用户指令或项目 AGENTS.md。索引中的源路径相对于该目录，安装 skill 不会复制参考美术资源；本机分析缓存不存在时重新读取实际源工程。

默认使用 [交互预览](../modules/interactive-preview.md)：暂停、逐帧、慢放、时间轴、关键姿势和缩放。新任务直接从原始绘制/渲染生成无损帧或运行时播放，不生成 GIF；仅用户明确要求时导出 GIF。脚本、蓝图和预览一起核对，同一已通过范围不逐阶段再次确认。

## 产物

默认正式交付位于工作项目的 `exports/<task>/`：动作 brief、素材蓝图、透明 PNG、原位清单、工作 PSD、Spine 工程、成品预览及验收记录。运行时数据和图集按需导出。临时文件与制作前预演数据 位于工作项目的 `.work/<task>/`，技能安装目录不作为工作项目输出目录。

完整结构和判断标准见 [技能入口](../SKILL.md)，文案粒度见 [单图挥手示例](wave-example.md)。示例只说明写法，不预设每个角色的时长、部件或版本。
