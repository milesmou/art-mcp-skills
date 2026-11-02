# 公开制作方法与本项目适配

2026-11-02 按用户选定方向核对以下公开技能正文。这里记录方法来源和适配边界，具体执行决策已经融入现有模块；未导入上游脚本、模型、示例美术或另一套技能安装目录。公开案例的验收和性能记录不代表本项目已实测。

## 动作设计与诊断：Spine-SKILL

来源为 [zxzAndyMAC/Spine-SKILL](https://github.com/zxzAndyMAC/Spine-SKILL)：

| 已核对文件 | 文件 blob SHA | 本项目采用位置 |
| --- | --- | --- |
| [motion-and-rig.md](https://github.com/zxzAndyMAC/Spine-SKILL/blob/main/skills/spine-animation/references/motion-and-rig.md) | `c40218ab12e791060cce703dc0a479bfb5d8d5dc` | [导演与剧本](../modules/direction.md#主姿势与节奏的设计决策)：围绕意图、支撑和运动传递组织姿势/时间；[绑定](../../spine-skill/modules/rigging.md#约束与验收)：按视觉需要选驱动方法 |
| [diagnosis-and-lessons.md](https://github.com/zxzAndyMAC/Spine-SKILL/blob/main/skills/spine-animation/references/diagnosis-and-lessons.md) | `61b0e520522c351e22862d038a227fd883bfa192` | [防穿帮与动作优化](../../spine-skill/modules/motion-quality.md#先定位原因)：复现被拒版本，分离素材、装配、绑定、节奏、遮挡和播放器问题；隔离最小区间与主要变量 |

采用其判断方法，不照搬示例的时长、采样数量、运动参数或已通过结论。主动作成立后再做附属运动；指标不能抵消体积、姿势与遮挡缺陷。

## 素材与手势：game-asset-aesthetic-test

来源为 [zeroa234/game-asset-aesthetic-test](https://github.com/zeroa234/game-asset-aesthetic-test)：

| 已核对文件 | 文件 blob SHA | 本项目采用位置 |
| --- | --- | --- |
| [game-asset-spine-portrait/SKILL.md](https://github.com/zeroa234/game-asset-aesthetic-test/blob/main/extensions/skills/game-asset-spine-portrait/SKILL.md) | `de18476e266a30e70ff344c32dd843bbb11964f5` | [语义分层候选完整性](../../photoshop-skill/modules/image-part-split.md#语义分层候选的完整性)、[手势素材与过渡附件](../../photoshop-skill/modules/spine-image-repair.md#手势素材与过渡附件)：完整运动部件、统一画布配准、重合成后绑定、实际手形替换和过渡检查 |
| [game-asset-spine-cutout/SKILL.md](https://github.com/zeroa234/game-asset-aesthetic-test/blob/main/extensions/skills/game-asset-spine-cutout/SKILL.md) | `a4c8db7746db84898da6802b6673461be316ea57` | [素材蓝图](../modules/asset-blueprint.md#手势与过渡素材计划)：按姿势、握点、挂点和层次规划；完整关节及隐藏区域不靠颜色差分切开 |

## 适配边界

- 保持本项目导演 → Photoshop → Spine 的职责和 `spine_manifest.json` 坐标交接，继续使用既有动作参考库、制作前交互预演确认与交付前自查，默认不生成 GIF。
- 上游涉及 Spine 4.2/4.3 的物理、数据格式、手工编辑器流程或特定引擎，不直接套入当前 3.8.99 工程。执行时查询实际版本与 MCP 能力；不支持的效果使用经验证的关键帧/约束方案或列出缺项，不改版本字符串假装兼容。
- See-through、视频姿态推理等只作为可选素材/参考来源，不因阅读方法就安装依赖、上传用户图或宣称模型已运行。候选要检查完整性、坐标和活动范围；不照搬历史 IoU、像素误差和显存结论。
- 原画可用像素优先保留，但目标完整部件与原片叠加不兼容时，比较后可以整件采用并记录来源；不以保留原像素为由造成双轮廓，也不整张替换角色身份。
- 本次变更是技能方法整合与文档校验，不是对当前角色的新动画修复或美术验收；角色已有不通过项仍需在实际工程中修复复审。
