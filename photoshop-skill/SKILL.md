---
name: photoshop-skill
description: "通过 UXP 操作 Photoshop，支持通用文档编辑、游戏 UI 分辨率适配与切图，以及 Spine 动画部件导出。用于需要在 Photoshop 中处理 PSD 或导出素材的任务。"
---

# Photoshop

这是 Photoshop 功能的统一技能入口。根据用户目标读取下列模块；模块是内部参考文档，不是需要单独调用或安装的技能。

## 按任务读取

| 用户目标 | 需要读取的模块 |
| --- | --- |
| 读取或编辑 Photoshop 文档、图层、文字、蒙版、效果，或执行普通导出 | [通用 Photoshop](modules/photoshop.md) |
| 按游戏设计分辨率适配设计稿，切出按钮、图标、面板等 UI 资源 | [通用 Photoshop](modules/photoshop.md) + [游戏 UI 切图](modules/game-ui-slice.md) |
| 将角色或物件 PSD 拆成 Spine 动画部件，处理表情、动作替换件与初始摆位 | [通用 Photoshop](modules/photoshop.md) + [游戏 Spine 切图](modules/game-spine-slice.md) |

- 仅加载当前任务需要的模块；模块链接的 API、数据格式和案例也按需读取，不预读全部参考资料。已读模块无需重复读取。
- 根据交付用途选择切图模块，不仅凭“PSD”“切图”或“角色”等词判断。结合用户说明和文档结构仍无法确定用途时，询问是 UI 资源还是 Spine 动画部件；等待期间可按通用模块读取源稿。
- UI 与 Spine 的业务规则分别适用：UI 要求游戏设计分辨率，对齐组共用画布；Spine 默认原尺寸，部件紧裁并留 2 px 透明边，通过坐标还原原位。不要将两套默认规则互相套用。
- 同一任务明确包含两类资源时，分别读取对应模块并为各自资源执行规则。仅生成 Spine 初始摆位 JSON 不代表完成绑定或动画。
- 用户明确设置优先于模块默认值。两个切图模块共用通用模块的 UXP 执行与源稿保护约定，脚本、模板和参考均包含在本技能目录中。

## 调用示例

- `使用 $photoshop-skill，读取当前 PSD 的图层结构并导出预览。`
- `使用 $photoshop-skill，将 D:/art/ui.psd 按游戏设计分辨率 1080×1920 切成 UI 素材。`
- `使用 $photoshop-skill，将 D:/art/hero.psd 按原尺寸切成 Spine 动画部件，包含隐藏表情，目标 Spine 3.8.99。`
