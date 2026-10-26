# See-through 单图分层与 Spine 衔接

2026-10-23 查阅上游 [README](https://github.com/shitagaki-lab/see-through)、[推理入口](https://github.com/shitagaki-lab/see-through/blob/main/inference/scripts/inference_psd.py)、[分层实现](https://github.com/shitagaki-lab/see-through/blob/main/common/utils/inference_utils.py) 和 [后处理入口](https://github.com/shitagaki-lab/see-through/blob/main/inference/scripts/heuristic_partseg.py)。这是可选外部后端的操作参考，当前仓库未内置模型、安装器或 MCP 接口，也未完成本机推理实测。执行前核对实际 checkout 的参数、依赖及提交号。

## 能力与边界

See-through 使用 LayerDiff 生成带透明度的语义层、补全遮挡区域，再结合 Marigold 伪深度组织分层，可输出最多 23 类语义层的 PSD。它适合作为扁平角色图进入 Photoshop 的初稿，不生成 Spine 骨架、权重、IK、表情替换或动作关键帧；上游也明确将绑定和更细的美术拆分列为后续工作。

- 只有扁平图、需要恢复遮住的身体或区分前后发/衣料时，优先评估该后端；已有完整分层 PSD 时直接使用现有素材。
- 语义层不等于运动部件：衣服可能仍需拆成袖子、上衣和裙摆，双眼、双手或前后发也可能混在同层。不能将 23 类固定映射为 23 根骨骼。
- 输出是生成式候选。检查人物身份、脸型、手指、武器形状、服饰纹样和原画笔触；补出的内容不能当作原稿的真实隐藏设计。无须重建的可见像素优先保留原稿。
- 本角色一类手持长武器的图，要特别检查手指/护手粘连、剑鞘完整性、两手与武器的接触，以及前臂、腰带、衣摆的前后关系。

## 环境与执行

按上游当前说明在独立环境安装，避免改动 Spine MCP 的运行环境。上游示例使用 Python 3.12、PyTorch 2.8/CUDA 12.8；1280 分辨率的默认推理约需 12–16 GB 显存，group offload、NF4 和 block swap 是上游提供的降显存路径。这些是上游配置参考，不是本机兼容性或性能保证；不同模式分别检查入口与依赖，不能假定参数完全相同。

执行前记录仓库提交、Python 路径、GPU/显存、模型标识和是否已有权重；缺少环境时标为后端未就绪，继续现有 Photoshop 拆件与补图流程。只有用户要求调用在线演示时才上传原图到第三方服务，不将本地拆件自动切换为云端上传。

标准推理的已核对参数如下，工作目录必须是 See-through 仓库根目录；路径使用任务实际位置，输出到新的候选目录，不能覆盖原稿：

```powershell
python inference/scripts/inference_psd.py --srcp "<source.png>" --save_dir "<task>/candidates/see-through" --save_to_psd --seed 42 --resolution 1280
```

`--group_offload` 可选；标准入口还有 `--resolution_depth`、`--tblr_split`。`--tblr_split` 只表示尝试进一步划分，不保证得到符合角色自身左右约定的全部部件。低显存量化使用上游单独的 `inference_psd_quantized.py` 及相应依赖，以该入口帮助为准。

如需进一步按深度或左右划分，先确认实际生成 PSD 的路径和层标签，再针对候选副本调用：

```powershell
python inference/scripts/heuristic_partseg.py seg_wdepth --srcp "<candidate.psd>" --target_tags handwear
python inference/scripts/heuristic_partseg.py seg_wlr --srcp "<depth-result.psd>" --target_tags handwear-1
```

示例标签来自上游，不是每个角色都存在的固定名称；枚举实际输出文件，不拼接猜测后处理文件名。不把左右分割直接解释为角色自身左右，也不直接用深度值排列全部 Spine slots。

## 候选 PSD 到可动画部件

上游 V3 分身体与头部两阶段推理。身体输入通过 `center_square_pad_resize` 补成正方形并缩放，保存 `src_img.png`；头部另裁切推理后放回全图位置。核对原图、`src_img.png` 和实际 PSD 的关系，不把推理分辨率当作原始角色尺寸，也不要将已放回全图的脸部层再次居中或二次偏移。

| 上游 V3 标签示例 | Spine 整理重点 |
| --- | --- |
| `front hair`、`back hair` | 确认前后遮挡，按实际摆动需求进一步拆发束 |
| `irides`、`eyewhite`、`eyelash`、`eyebrow` | 复核左右与眼部蒙版；这些静态层不自动包含闭眼或其他表情 |
| `topwear`、`bottomwear` | 按袖根、腰线和裙片运动关系拆分，不整件衣服统一拉伸 |
| `handwear`、`legwear`、`footwear` | 复核具体覆盖的是皮肤还是衣物、左右归属和关节搭接，不凭标签直接认定为手掌或完整肢体 |
| `objects` | 确认武器/道具是否完整及其与手的接触，按刚性对象绑定 |

1. 在 Photoshop 中打开实际 PSD，保留原图与候选副本，查看完整层树、单层 Alpha、遮挡补全和合成预览。输出图层数、脚本退出码或 PSD 存在都不证明拆分正确。
2. 比较源尺寸与候选画布，确认推理是否缩放、补边或裁切；用脸部、腰线等稳定特征确定对应变换。保持统一坐标，不按各部件包围盒分别居中。若发现非等比失真或局部漂移，校正候选或放弃相关层，不只修改清单尺寸。
3. 按目标动作建立“语义层 → 运动部件 → slot/attachment → 骨骼/网格”的映射。需要同时出现的左右肢体和前后片分 slot，互斥表情才做附件切换。整件衣服内要独立运动的袖子、裙片继续拆分。
4. 检查被遮部位是否真的有完整像素、轮廓和关节搭接。背景残留、错误补出的手指、武器断裂和脸部变化按 [补图流程](../../modules/spine-image-repair.md) 修正；未通过项保持 `needs_redraw`。
5. 确认静态层序后试摆目标姿势；手/武器、袖/躯干、头发/脸等出现交替遮挡时，补前后片或安排 Spine draw order。伪深度仅提供初始遮挡线索。
6. 按 [Spine 部件交付格式](delivery.md) 紧裁、导出、记录坐标并重建原位；接回 Spine 的枢轴、网格、权重、IK 和动作制作。新结构先在极限姿势及循环中验证，不能停在 PSD 或 PNG 交付。

## 溯源与验收

沿用 `spine_manifest.json`，可以追加可选 `decomposition` 元数据，记录后端名称、真实 checkout 提交、模型、seed、分辨率、原图、候选 PSD、画布变换、采用/拒绝的图层和理由。原稿只有整图时，不伪造原始分层 ID；候选生成层与原稿来源分别记录。实际补绘采用情况沿用 `repairs`，不要以生成记录替代验收状态。

验收包含原位合成差异、单层边缘与 Alpha、遮挡区补全、关节试摆，以及目标动作的正常速度播放。原图复原相似仍可能在抬臂或转头时露底；模型分层成功不等于动画素材合格。

上游代码仓库标注 Apache-2.0；本流程只链接和调用外部安装，不复制上游源码或权重。分发模型或依赖时另核对相应模型卡与第三方许可，不能把代码仓库的许可自动套到所有权重。
