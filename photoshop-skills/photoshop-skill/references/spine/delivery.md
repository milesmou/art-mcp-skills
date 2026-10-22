# 交付数据约定与初始导入

## 目录

```text
<task>/
  images/                 只放交付的部件 PNG
  spine_manifest.json     来源、坐标、状态与映射
  spine_import.json       已知目标版本时生成的初始摆位
  previews/               setup 重建、替换件联系表、检查结果
```

`spine_import.json` 不是 `.spine` 工程，也不含绑定和动画。用户只要求图片时可以不生成。参考工程不复制进交付物；更新既有资产的差异报告放任务根目录。

## 清单 v1

示例坐标只是说明数据格式；不能以示例的比例、原点或尺寸代替实际测量。

```json
{
  "schema_version": 1,
  "source_psd": "D:/art/hero.psd",
  "source_size": [9500, 3948],
  "scale": 1,
  "scaled_size": [9500, 3948],
  "images_dir": "images",
  "padding": 2,
  "left_right_convention": "character",
  "poses": {
    "cs": {"origin": [1000, 3600], "basis": "measured ground anchor", "setup": true},
    "kx": {"origin": [4700, 3600], "basis": "corresponding ground anchor", "setup": false}
  },
  "parts": [
    {
      "source_ids": [123],
      "source_path": "初始/tou/lian",
      "original_name": "lian",
      "original_visible": true,
      "original_effective_visible": true,
      "status": "exported",
      "file": "cs_lian.png",
      "pose": "cs",
      "slot": "lian",
      "attachment": "cs_lian",
      "setup": true,
      "draw_order": 10,
      "export_box": [870, 600, 1131, 877],
      "png_size": [261, 277],
      "dependencies": [],
      "bone_hint": "head",
      "mesh_hint": false
    },
    {
      "source_ids": [456],
      "source_path": "开心卖萌/tou/zuiba",
      "status": "exported",
      "file": "kx_zuiba.png",
      "pose": "kx",
      "slot": "zuiba",
      "attachment": "kx_zuiba",
      "setup": false,
      "draw_order": 12,
      "export_box": [4650, 780, 4717, 826]
    }
  ],
  "coverage": [],
  "issues": [],
  "verification": {"png": "pending", "reconstruction": "pending", "spine_import": "pending"}
}
```

- `export_box` 是包含透明 padding 的最终整数边界，右/下端不包含；源图层 bounds 不是已核实的渲染边界。`poses.*.origin` 是同一缩放整稿坐标系中的原点，可保留半像素。若有透明扩画布，先换算回此坐标系。
- `parts` 收录独立资源及待处理项。`coverage` 用层 ID/路径逐个记录没有直接成为 PNG 的节点（dependency/reused/excluded/pending/needs_redraw/failed）及原因、对应资源；分类组标记为容器，避免与其子层重复计数。空层可以 excluded，缺画不等于空层。
- `draw_order` 是 slot 的后到前整数序号，数字越大越靠前；不同 slot 不重复，同 slot 各替换件必须一致。依据 Photoshop 的渲染顺序建立，不能按文件名字母排序。姿态之间不同的遮挡需求写入 `issues`，需要额外 slot 或在动画中调整 draw order，不能在静态 JSON 中同时表达两种顺序。
- `setup` 是该 attachment 是否在初始摆位显示，不直接抄图层 visible。每个 slot 最多一个 true；特效/动作专用 slot 可以全 false。示例的嘴 slot 因没有基准嘴附件而初始为空；实际任务需按设计补上对应的正常嘴附件。
- `slot`、`attachment`、`file` 各有用途：同 slot 的手势互斥，attachment 是替换件标识，file 是相对 `images_dir` 的真实路径。文件大小写保持准确，JSON 图片 path 不带 `.png`。
- `bone_hint`、`mesh_hint`、关节位置、缺画、依赖转换和源坐标等供后续绑定使用；生成器不会据此伪造骨骼或权重。重复资源保留一个 exported 实体，其他源节点在 coverage 引用它。

## 生成初始摆位 JSON

从仓库根目录运行（Python 3.10+，只需标准库）：

```powershell
python photoshop-skills/photoshop-skill/scripts/build_spine_json.py D:/exports/hero/spine_manifest.json --spine-version 3.8.99
```

默认在清单旁生成全新的 `spine_import.json`，已存在则拒绝覆盖；修改后重建可用 `--output D:/exports/hero/spine_import_v2.json`。相对清单定位图片，不受命令工作目录影响；输出 JSON 另放目录时自动更新 `skeleton.images` 的相对路径。

工具支持最小 region 数据所需的 3.8.x、4.0.x–4.2.x 版本标记，必须传入实际编辑器完整版本号；不是将旧项目升级的转换器。其他版本先核对对应官方格式，或仅交付图片和清单。3.8 已使用 skins 数组，不能误用更早的 skins 字典结构。它仅生成 default skin、root 和普通附件；多 skin、已有 mesh、clipping、骨骼变换、动画需单独按目标版本处理。

执行时检查坐标有限且边界有效、RGBA8 PNG 头部尺寸匹配、路径不越出交付目录、同名图片不冲突、slot 顺序和混合模式一致、setup 不重复。非 exported 项不会加入骨架，仍须在交付中报告。**头部校验不证明 PNG 全部数据可解码、Alpha 非空、颜色正确或编辑器可导入**；继续做 skill 中的视觉与导入验收。

## 官方格式依据

最小导入使用 root、按后到前排列的 slots、default skin 中的 region 附件；坐标相对所属骨骼，图片通过去除扩展名的 path 查找。参考 [Spine JSON 格式](https://esotericsoftware.com/spine-json-format)。

格式实例：[官方 3.8 示例](https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/3.8/examples/spineboy/export/spineboy-pro.json)、[官方 4.2 示例](https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/4.2/examples/spineboy/export/spineboy-pro.json)。仅参考数据结构，未复制示例角色、动画或第三方脚本。

Spine 原生 PSD 导入也支持裁边、padding 和隐藏层选项，但样式/调整层等像素渲染存在限制。本 skill 采用 Photoshop 渲染，再交付可定位的 PNG 和 JSON。具体边界见 [Import PSD](https://esotericsoftware.com/spine-import-psd)。
