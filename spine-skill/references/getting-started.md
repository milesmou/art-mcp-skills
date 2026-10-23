# 安装与使用

[返回技能介绍](../README.md)

## 环境要求

- 配置并连接 [Spine MCP](../../spine-mcp/README.md)，服务端需要 Node.js 20+ 和已安装、激活的 Spine 3.8 Professional。
- 当前 MCP 服务支持 Spine 3.8.x；其他系列先查询能力，不通过修改版本字符串转换工程。
- 使用 JSON 分析脚本时还需要 Python 3，脚本仅依赖标准库。

自动权重额外依赖服务端的 libigl BBW 求解器；安装说明见 [外部工具](../../spine-mcp/docs/EXTERNAL_TOOLS.md)。

## 使用示例

```text
使用 spine-skill/SKILL.md，读取 D:/art/hero.spine，在现有 idle 基础上制作一个更轻的呼吸循环，保留原动作并导出预览。
```

```text
使用 spine-skill/SKILL.md，将已拆分的角色 PNG 装配为 Spine 3.8 骨架，检查枢轴、层次和权重后制作待机动画。
```

技能完整指令位于 [SKILL.md](../SKILL.md)。在其他项目使用时，安装整个 `spine-skill/` 目录，保留脚本和参考资料的相对位置。

## 制作流程

1. 读取目标工程的版本、骨架、附件与动画，确认实际编辑目标。
2. 从适用的基线动作派生，或从拆分贴图装配骨架、绑定权重并设置约束。
3. 制作主姿势与节奏，再补头发、衣料、表情、换图和绘制顺序。
4. 保存后回读、校验引用并检查动画预览，按交付需求导出 `.spine`、运行时数据和图集。

从 PSD 开始的任务先使用 [Photoshop Spine 部件切图](../../photoshop-skill/modules/game-spine-slice.md)。切图生成的初始摆位 JSON 不代表已完成绑定或动画。

## 分析导出 JSON

以下命令均在 **art-mcp-skills 项目根目录** 运行。输入须为 MCP 导出的骨架 JSON：

```powershell
python spine-skill/scripts/inspect_spine_json.py .work/reference-export/mainGirl1.json --output .work/reference-summary.json
```

检查某段动画的换图、绘制顺序和骨骼端点差异：

```powershell
python spine-skill/scripts/inspect_spine_json.py .work/reference-export/mainGirl1.json --animation run --output .work/run-summary.json
```

该脚本只读 Spine 3.8.x 导出 JSON，不直接解析 `.spine` 或 `.skel`，也不替代运行时采样与视觉检查。`.work/` 用于本机快照和临时验证，已加入 Git 忽略规则。

## 详细文档

- [MCP 操作工作流](mcp-workflows.md)：参数示例、动画编辑、网格与权重、预览和恢复。
- [mainGirl1 女主参考工程](main-girl.md)：骨骼映射、19 段动画、附件组织和实测问题。
- [服务端编辑事务](../../spine-mcp/docs/HEADLESS_EDITING.md)：后台重建、数据保留和回读验证。
- [日常编辑操作](../../spine-mcp/docs/DAILY_OPERATIONS.md)：权重、布料、FFD、事件和动画片段。
