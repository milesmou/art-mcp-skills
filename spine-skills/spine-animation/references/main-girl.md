# mainGirl1 女主工程参考

本页记录 2026-10-22 对指定 `.spine` 的只读分析、CLI JSON 导出及 MCP 预览结果。现有工程再次变化时重新读取；其他角色只借鉴组织方式，不照搬骨骼名和参数。

## 来源与资源

| 项目 | 实测值 |
| --- | --- |
| 工程 | `D:/Workspace/XiaoGuan/art/spine/女主/mainGirl1/女主.spine` |
| 源工程 SHA-256 | `3341781d3c7ca2828749a3c7709c21447b2c51d9eb432ec7cd8b570418f652d1` |
| 骨架 / 版本 | `mainGirl1` / `3.8.99` |
| 工程帧率 | 30 FPS，由参考工程副本的 MCP dry-run 结果确认 |
| 结构 | 141 骨骼、69 插槽、1 个 `default` 皮肤、87 附件、2 IK、0 事件 |
| 附件类型 | 46 region、41 mesh；mesh 中 32 加权、9 非加权 |
| 图片目录 | 工程同级 `images/`，JSON 的 `skeleton.images="./images/"` |
| 图集 | `out/mainGirl1.atlas` + `out/mainGirl1.png`，页面尺寸 2001 × 523 |
| 旧运行时数据 | `out/mainGirl1.skel`，不能假定与当前工程同步 |

工程文件名为“女主”，图集和骨架名为 `mainGirl1`。本次 `spine_check_project` 的引用校验通过，却报告未找到 atlas；显式传入上述路径即可渲染。不要因为自动查找失败就重打包或改名。

## 主要控制层级

| 作用 | 实际层级 / 对应关系 | 编辑提示 |
| --- | --- | --- |
| 全局、身体 | `root → zheng → shen1 → shen2 → bone4 → bone5` | `zheng` 负责身体位移；`bone5` 下挂面部与头发，作为头部控制候选 |
| 左臂 | `shen2 → z-shou1 → z-shou2 → z-shou3 → itemL` | `CS_zuoxiuzi / CS_zuoshoubi / CS_zuoshou` 分别绑定前三根 |
| 右臂 | `shen2 → y-shou1 → y-shou2 → y-shou3 → itemR` | 对应 `CS_youxiuzi / CS_youshoubi / CS_youshou` |
| 常规右腿 | `zheng → bone6 → bone7`，IK 目标 `root → bone8` | `bone8` 同时绑定右鞋和鞋球；IK 名也叫 `bone8` |
| 常规左腿 | `zheng → bone9 → bone10`，IK 目标 `root → bone11` | `bone11` 绑定左鞋和鞋球；IK 名也叫 `bone11` |
| 前发 / 刘海 | `bone5 → hair`，分支延伸到 `hair17` | 通过加权网格随多根辅助骨骼变化 |
| 后发 | `bone5 → houfa`，分支延伸到 `houfa20` | 不把整个后发当刚性 region 旋转 |
| 眉眼嘴 | `bone5 → eyes / meim / mouth`，`meim → meim1 / meim2` | 眼线、脸部还有独立 FFD |
| 衣摆、布料 | `zheng` 下的 `bone30…bone41` 等分支 | 必须结合网格权重确认具体影响区域 |
| 特殊动作肢体 | `bone58…bone87` 与 `root…root8`、`KX_*` 插槽 | 是另一套动作表现资源，不能因名字普通而删除 |
| 效果 | `xingxing → KX_aixin`；`SD…SD4 → LT_zaogao*`；`smoke → smoke1/smoke2` | 附件在动画中特定时刻显示/隐藏 |

左右根据实际 `CS_zuo* / CS_you*` 插槽绑定确认，不根据画面左右猜测。骨骼数组索引和名称含数字不代表可镜像配对。

模板映射时可从 `shen1→torso`、`bone5→head`、`z-shou1→armL`、`z-shou2→forearmL`、`z-shou3→handL` 及对应右臂起步，但必须再核对姿态和预览。这是候选方案，不是经过生成动作验证的万能映射。`root` 与 `zheng` 的运动职责、IK 腿如何驱动需按动作单独设计。

## 动画库与节奏

时间取当前导出 JSON 的最大关键帧时间。工程帧率经 MCP dry-run 确认为 30 FPS，所有动画关键帧也都落在该时间网格上（四位小数误差内）。对其他工程先查询实际 FPS，不仅靠时间网格推断。

| 动画 | 时长（秒） | 制作参考 |
| --- | --- | --- |
| `idle` | 1 | 基础待机；身体上下约 3.53 单位，面部 FFD 眨眼 |
| `idleL` / `idleR` / `idleALL` | 各 1 | 单侧/双侧手臂附件变体 |
| `walk` / `walkL` / `walkR` / `walkALL` | 各 0.8 | 一周期约 24 帧；骨盆每 0.2 秒一个主要起伏姿势 |
| `run` / `runL` / `runR` / `runALL` | 各 0.5333 | 一周期约 16 帧；前倾更大、脚部 IK 与身体起伏配合 |
| `doing` | 0.5333 | 具体业务语义需结合使用方，勿仅凭名称判断 |
| `idle_act_1` | 2.1667 | 待机附加表现，包含换图、面部 FFD、绘制顺序 |
| `idle_act_2` | 1.3333 | 同上 |
| `idle_act_3` | 1.8667 | 还包含绑带、躯干 FFD |
| `lose` | 1.6667 | 抱头失落，切换表情和困扰效果 |
| `win` | 2 | 跳起、手势和爱心，切换特殊肢体资源 |
| `dance` | 4 | 双臂摆动、身体节奏、衣摆与袖口 FFD；包含大量逐帧采样 |

共 19 段。后缀 `L / R / ALL` 在本工程表示附件与手臂姿态的差异；不能推断为朝向或纯镜像。对其他项目重新核对语义。

## 换图、层次与形变的协作

本工程只有一个皮肤；多套表情/肢体表现主要由插槽附件切换和专用插槽实现。

- `idleL` 切换 `CS_zuoshou→DP_zuoshou`、`CS_zuoshoubi→DP_zuoshoubi`、`CS_zuoxiuzi→DP_zuoxiuzi-1`，并显示 `z-shou1` 插槽中的 `DP_zuoxiuzi`。`idleR` 切换对应右侧三个附件；`idleALL` 组合两侧。
- `walk / run` 的手部使用 `BP_*`，部分前臂使用 `DP_*`；`walkALL` 则组合整套 `DP_*`。`BP / DP` 的业务全称未经确认，不自行解释为某个物品或装备类别。
- `CS_zuiba` 插槽含 `CS_zuiba / KX_zuiba / LT_zuiba`；眉毛也有 `CS_* / LT_*` 备选。`win` 在约 1 秒切换手臂，1.0667 秒换嘴形，1.2 秒显示 `KX_aixin`。
- 常规腿与 `KX_*` 特殊腿在 `win` 中切换可见性。只复制身体轨道会造成多套腿同时显示或跳跃姿势缺件。
- 手臂前后关系由 `drawOrder` 控制。比如 `win` 在 0.7 秒另设绘制顺序；新增动作应继承适用基线后再调整，不能仅换图。
- `idle` 的 `CS_lian / CS_yanxian / CS_yanxian2` 使用 FFD。走跑的 FFD 还涉及绑带、躯干、衣摆和腰带；`dance` 包含脸、眼线、两片衣摆及双袖 FFD。

典型网格：`CS_lian` 92 个逻辑顶点，非加权；`CS_qunzi` 57 个、`CS_qunzi2` 49 个、`CS_liuhai1` 19 个，均为加权。加权网格的 `vertices` 存储骨骼影响项，不能用 `len(vertices)/2` 当顶点数。

## 可复用的方法与现有问题

**可借鉴：** 身体主控与脚部 IK 分离；主肢体骨骼配合布料/头发辅助骨；面部 FFD 与离散表情换图协作；基础动作派生附件变体；原地走跑把实际场景位移留给使用方。具体游戏是否这样播放仍需查使用方代码。

**不照搬的地方：**

- 自动模板角色只识别 `root`，但体检仍列出全部模板可用。可用清单不能证明角色匹配完整或动作质量合格。
- 当前 `run` 的 `zheng.translate.y` 首帧 `-45.66`、末帧 `-58.69`；`bone36.rotate` 首尾也不同。这是循环检查风险，不能仅凭动作名标记通过。制作新循环时按需求修正，参考分析本身不改原作。
- `dance` 有 8417 个关键帧，是当前工程的采样结果；无需把逐帧烘焙数量作为所有新动作的标准。
- 已查看 `idle / walk / dance / win / lose` 各 8 帧 MCP 序列预览，返回 `renderer="spine-runtime"`。脸部可见三角接缝，源脸部 PNG 未见相同三角轮廓；原因未完成定位，需要与编辑器/目标运行时对照。这些预览证明路径可用、动作大体可见，不代表美术最终验收。
- 上述 sequence 预览不含精确终点，也未验证实际游戏内动作切换、事件或资源同步。

## 更新本页证据

使用 `spine_export_animation(format="json")` 获取当前快照，然后执行（路径替换为实际位置）：

```powershell
python spine-skills/spine-animation/scripts/inspect_spine_json.py .work/reference-export/mainGirl1.json --output .work/reference-summary.json
python spine-skills/spine-animation/scripts/inspect_spine_json.py .work/reference-export/mainGirl1.json --animation run --output .work/run-summary.json
```

脚本的首尾差异是原始数据诊断，不会插值、求世界姿势或自动判断动作是否循环；最后仍以 MCP 采样和视觉检查为准。
