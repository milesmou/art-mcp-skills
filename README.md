# art-mcp-skills

Photoshop 素材处理与 Spine 动画制作工具、技能集合。项目仓库：[milesmou/art-mcp-skills](https://github.com/milesmou/art-mcp-skills)。

```text
art-mcp-skills/
├── spine-mcp-server/          # MCP 服务源码、测试和服务文档
├── spine-skills/
│   └── spine-animation/
├── photoshop-skills/
│   └── photoshop-skill/
├── AGENTS.md
└── README.md
```

每个 skill 直接放在对应分类目录下，保留自身的 `SKILL.md`、`agents/`、`references/`、`scripts/` 和所需资源。本项目通过 [AGENTS.md](AGENTS.md) 按任务指向技能入口；在其他项目使用时，将整个 skill 目录安装到对应客户端的技能目录。

| 入口 | 主要用途 | 依赖 |
| --- | --- | --- |
| [photoshop-skill](photoshop-skills/photoshop-skill/SKILL.md) | Photoshop 编辑、游戏 UI 切图、Spine 部件切图 | Photoshop 23.5+、Python 3.10+，通过内置 UXP 模板与启动器运行 |
| [spine-animation](spine-skills/spine-animation/SKILL.md) | 骨架装配、权重绑定、IK、动作制作、FFD、预览与导出 | `spine-mcp-server`、Spine 3.8 Professional |

## Photoshop 技能

`photoshop-skills/photoshop-skill/` 整合自本机 `D:/Workspace/photoshop-skill` 项目的技能目录，来源仓库为 [milesmou/photoshop-skill](https://github.com/milesmou/photoshop-skill)，对应提交 [`96e8191fcf8a9c7a96a63c27036fdb13f9c3c834`](https://github.com/milesmou/photoshop-skill/commit/96e8191fcf8a9c7a96a63c27036fdb13f9c3c834)。包含三个按需模块：

- [通用 Photoshop](photoshop-skills/photoshop-skill/modules/photoshop.md)：文档、图层、UXP 执行和结果回读。
- [游戏 UI 切图](photoshop-skills/photoshop-skill/modules/game-ui-slice.md)：设计分辨率适配、静态文字拆分、动态占位和共同画布。
- [游戏 Spine 切图](photoshop-skills/photoshop-skill/modules/game-spine-slice.md)：原位坐标、遮挡、隐藏替换件、交付清单和初始摆位。

启动 Photoshop 后，可执行读取当前文档的脚本（以下命令从本项目根目录运行）：

```powershell
python photoshop-skills/photoshop-skill/scripts/run_uxp.py photoshop-skills/photoshop-skill/scripts/probe.psjs
```

只生成脚本、检查模板组合，不启动 Photoshop：

```powershell
python photoshop-skills/photoshop-skill/scripts/run_uxp.py photoshop-skills/photoshop-skill/scripts/probe.psjs --prepare-only
```

启动器仅依赖 Python 标准库，Windows 自动定位正在运行的 Photoshop，macOS 可自动定位唯一安装。具体执行、超时收集和回读规则见 [脚本运行说明](photoshop-skills/photoshop-skill/references/running-scripts.md)。

## 从 PSD 到 Spine 动画

1. 用 `photoshop-skill` 的 Spine 切图模块，从 PSD 导出原尺寸透明部件、`spine_manifest.json` 与检查预览；目标版本和映射已知时生成 `spine_import.json`。
2. 用 `spine-animation` 和 MCP 服务装配骨骼、绑定权重、设置约束并制作动作。初始摆位 JSON 只还原部件位置，不代表已完成绑定或动画；版本能力以 MCP 查询结果为准。
3. 检查动画预览与引用，再导出目标运行时需要的数据和图集。

Photoshop 部件交付约定见 [交付数据说明](photoshop-skills/photoshop-skill/references/spine/delivery.md)。

## MCP 服务

`spine-mcp-server/` 导入自 [milesmou/spine-mcp-server](https://github.com/milesmou/spine-mcp-server)，对应提交 [`edf9724d5661d00366d6b11009b955ab930a41c7`](https://github.com/milesmou/spine-mcp-server/commit/edf9724d5661d00366d6b11009b955ab930a41c7)。该目录保存仓库跟踪的源码内容，作为本项目的普通子目录维护。

在项目根目录运行：

```powershell
npm --prefix spine-mcp-server ci
npm --prefix spine-mcp-server run build
npm --prefix spine-mcp-server test
```

服务需要 Node.js 20 或更高版本以及已安装、激活的 Spine 3.8 Professional。运行时配置使用 `spine-mcp-server/.env`，模板见 [.env.example](spine-mcp-server/.env.example)；也可由 MCP 客户端传入环境变量。服务详细说明见 [服务文档](spine-mcp-server/README.md)。

以下客户端配置假设项目根目录已改名为 `D:/Workspace/art-mcp-skills`，实际路径不同则替换 `args` 中的路径：

```json
{
  "mcpServers": {
    "spine-mcp": {
      "command": "node",
      "args": ["D:/Workspace/art-mcp-skills/spine-mcp-server/dist/index.js", "mcp"],
      "env": {
        "SPINE_EXE": "D:/Applications/Spine/Spine.com",
        "SPINE_VERSION": "3.8"
      }
    }
  }
}
```

`SPINE_EXE` 改为本机实际路径。客户端后续若改用本项目中的服务，将启动路径更新为上述新位置。

## Spine 技能

[spine-animation](spine-skills/spine-animation/SKILL.md) 覆盖骨架装配、网格权重、IK、动作编辑、换图与表情、FFD、预览检查及导出，依赖 MCP 服务。参考工程分析见 [mainGirl1 女主工程](spine-skills/spine-animation/references/main-girl.md)。

在根目录分析已导出的骨架 JSON：

```powershell
python spine-skills/spine-animation/scripts/inspect_spine_json.py .work/reference-export/mainGirl1.json --output .work/reference-summary.json
```

## 验证与产物

Photoshop 启动器与初始摆位生成器的测试无需启动 Photoshop 或 Spine：

```powershell
python -m unittest discover -s photoshop-skills/photoshop-skill/scripts/tests -v
```

服务测试使用上文的 `npm --prefix spine-mcp-server test`。临时快照和验证产物放在 `.work/`；Photoshop 默认素材交付放在 `exports/` 的独立任务目录。两个目录与 Python 缓存均已加入 Git 忽略规则。
