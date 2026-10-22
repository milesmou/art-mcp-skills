---
name: spine-skill
description: 通过 spine-mcp 统一处理 Spine 工程检查、骨架装配与绑定、角色动画制作、预览和导出。适用于已有 .spine 工程编辑、拆分 PNG 装配、网格权重、IK、关键帧、换图表情及 FFD。按任务读取功能模块，参考 mainGirl1 女主工程的制作方法；不用于 Photoshop 切图或视频剪辑。
---

# Spine

这是 Spine 功能的统一技能入口，依赖 `spine-mcp`。根据用户目标读取下列模块；模块是内部参考文档，不单独注册、安装或调用。

## 按任务读取

| 用户目标 | 需要读取的模块 |
| --- | --- |
| 读取工程、查询版本与能力、检查层级或分析资源 | [工程通用](modules/project.md) |
| 从拆分贴图装配骨架，修改枢轴、权重或 IK 绑定 | [工程通用](modules/project.md) + [骨架绑定](modules/rigging.md) |
| 创建或修改动作、关键帧、表情、换图、FFD 和衣料跟随 | [工程通用](modules/project.md) + [动画制作](modules/animation.md) |
| 检查画面与循环、导出运行时资源、处理预览或恢复问题 | [工程通用](modules/project.md) + [预览交付](modules/delivery.md) |

- 仅加载本次任务所需模块；已读内容不重复读取。跨绑定、动画与导出的完整任务按阶段补读对应模块。
- 每次写入都执行工程通用模块的保存与回读检查；用户需要可见动画或运行时产物时，再按预览交付模块完成相应交付。
- 编辑目标以用户指定路径为准。引用参考工程表示借鉴方法，不自动将参考工程作为编辑目标。
- 延续女主绑定或动作时，按需读取 [mainGirl1 参考](references/main-girl.md)；该工程的骨骼名和参数不作为其他角色的默认值。
- 具体 MCP 参数与示例见 [操作工作流](references/mcp-workflows.md)，仅查阅当前操作的相关段落。工具支持范围以当前连接的 schema 和能力查询结果为准。
- `scripts/inspect_spine_json.py` 只读导出的 JSON，不直接解析或修改二进制 `.spine`。写出候选 JSON 或 dry-run 成功均不代表已保存工程。

## 调用示例

- `使用 $spine-skill，检查 D:/art/hero.spine 的版本、骨架和现有动画。`
- `使用 $spine-skill，将已拆分角色 PNG 装配为骨架，检查枢轴、层次、网格权重和 IK。`
- `使用 $spine-skill，在现有 idle 基础上制作呼吸循环，保留原动作并导出预览。`
