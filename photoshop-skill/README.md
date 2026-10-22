# Photoshop Skill

[返回项目首页](../README.md) · [Spine 动画技能](../spine-skill/README.md)

通过 UXP 操作 Photoshop，处理文档和图层，并导出游戏 UI 或 Spine 动画部件。统一入口为 [photoshop-skill](SKILL.md)，按任务加载所需模块。

## 模块

| 模块 | 用途 |
| --- | --- |
| [通用 Photoshop](modules/photoshop.md) | 文档、图层、文字、蒙版与效果，UXP 执行和结果回读 |
| [游戏 UI 切图](modules/game-ui-slice.md) | 设计分辨率适配、静态文字拆分、动态占位、按钮与进度条、共同画布 |
| [游戏 Spine 切图](modules/game-spine-slice.md) | 原位坐标、遮挡、表情与动作替换件、交付清单和初始摆位 |

UI 和 Spine 切图都使用通用 Photoshop 模块，但各自的缩放、裁切和对齐规则按交付用途选择。

## 环境要求

- Windows 或 macOS，已安装并启动 Photoshop 23.5+；具体 API 能力取决于版本。
- Python 3.10+，内置启动器仅依赖 Python 标准库。
- 可读取本技能的 agent，以及可访问的 PSD 文件。

脚本、UXP 模板、模块和参考资料均包含在 `photoshop-skill/` 中。

## 使用示例

```text
使用 photoshop-skill/SKILL.md，读取当前 PSD 的图层结构并导出预览。
```

```text
使用 photoshop-skill/SKILL.md，将 D:/art/ui.psd 按游戏设计分辨率 1080×1920 切成 UI 素材。
```

```text
使用 photoshop-skill/SKILL.md，将 D:/art/hero.psd 按原尺寸切成 Spine 动画部件，包含隐藏表情，目标 Spine 3.8.99。
```

需要在其他项目中使用时，安装整个 `photoshop-skill/` 目录，保留模块、脚本和模板的相对位置。

## 执行脚本

以下命令均在 **art-mcp-skills 项目根目录** 运行。

启动 Photoshop 后，读取当前文档并生成结构与预览：

```powershell
python photoshop-skill/scripts/run_uxp.py photoshop-skill/scripts/probe.psjs
```

只生成脚本，检查模板组合：

```powershell
python photoshop-skill/scripts/run_uxp.py photoshop-skill/scripts/probe.psjs --prepare-only
```

执行自己的任务正文：

```powershell
python photoshop-skill/scripts/run_uxp.py D:/tasks/task-body.psjs --timeout 90
```

启动器自动将任务正文与内置 harness 组合。超时后应按同一次运行的结果继续收集，避免重复启动；完整命令见 [脚本运行说明](references/running-scripts.md)。

## 交付与 Spine 衔接

默认交付到项目根目录 `exports/` 下的独立任务目录，按任务分别保存素材和清单。

- UI：透明 PNG、`qie_tu_qing_dan.json`，包含裁切坐标、动态文字和对齐信息。
- Spine 部件：`images/`、`spine_manifest.json`、检查预览；目标版本和映射已知时生成 `spine_import.json`。

初始摆位 JSON 还原部件位置，后续由 [Spine 动画技能](../spine-skill/README.md) 完成骨骼绑定、约束和动作制作。交付格式见 [Spine 部件数据约定](references/spine/delivery.md)，参考案例见 [女主案例](references/spine/main-girl-example.md)。

## 验证

启动器和 Spine 初始摆位生成器的测试无需启动 Photoshop 或 Spine，在项目根目录执行：

```powershell
python -m unittest discover -s photoshop-skill/scripts/tests -v
```

准备模式和测试只能验证脚本组合与数据处理，实际编辑、切图结果仍需在 Photoshop 中执行并回读检查。

## 来源

整合自 [milesmou/photoshop-skill](https://github.com/milesmou/photoshop-skill)，对应提交 [`96e8191`](https://github.com/milesmou/photoshop-skill/commit/96e8191fcf8a9c7a96a63c27036fdb13f9c3c834)。
