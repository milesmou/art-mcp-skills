# 🦴 Spine MCP Server

[返回项目首页](../README.md) · [Spine 动画技能](../spine-skills/README.md)

[![中文](https://img.shields.io/badge/lang-中文-red)](README.md) [![EN](https://img.shields.io/badge/lang-EN-blue)](README.en.md)

> AI 驱动的 Spine 3.8 动画工作流服务 · 供 Trae / Cursor / Claude Desktop / Codex / Windsurf / Cline 等 AI 客户端直接调用 Spine 编辑器能力

[![Node](https://img.shields.io/badge/Node-%3E%3D20-339933)](https://nodejs.org) [![Spine](https://img.shields.io/badge/Spine-3.8-yellow)](https://esotericsoftware.com) ![License](https://img.shields.io/badge/License-MIT-blue)

---

## 📖 简介

**Spine MCP Server** 是一个基于 [MCP（Model Context Protocol）](https://modelcontextprotocol.io) 的服务器，把 **Spine 3.8 Professional** 的编辑器能力封装成 85 个工具，让 AI 可以直接：

- 读取 Spine 项目（骨骼 / 插槽 / 皮肤 / 动画 / 事件 / 约束）
- 修改动画关键帧（旋转 / 位移 / 缩放 / 切变 / 曲线）
- 编辑骨架结构（增删骨骼 / 插槽 / 附件 / 皮肤 / 换装）
- 操作约束（IK / 变换 / 路径）与网格（FFD 变形）
- 图集拆分（立绘拆部件）、自动绑骨、图集重打包
- JS 运行时渲染动画预览帧

## ✨ 特性

| 能力 | 说明 |
|---|---|
| 85 个 MCP 工具 | 覆盖 Spine 主要功能域（信息/骨架/附件/约束/动画/图集/项目） |
| 外部工具集成 | 官方 CLI 图集打包、Alpha 自动网格、libigl BBW 自动权重；权重依赖运行 `npm run setup:external` 安装 |
| Round-Trip 修改 | 导出 JSON → 修改 → 原地导入，**自动备份**（`.bak`） |
| 版本适配 | 3.8.x 可用；4.2 适配器已预留，尚未开放编辑；支持工程版本和能力查询 |
| 后台编辑 (4) | rebuild_project · edit_animation · edit_keyframes · batch_edit |
| 安装向导 | 一键检测环境 + 写入配置 |

## 🔧 环境要求

- **Node.js ≥ 20**（开发机实测 v22）
- **Spine.com**（3.8 Professional，例如 `D:\Applications\Spine\Spine.com`）

## 🚀 快速开始

从 `art-mcp-skills` 项目根目录进入本服务目录；以下安装、构建和测试命令均在 `spine-mcp-server/` 中执行。

```powershell
cd spine-mcp-server

# 1. 安装依赖 + 构建
npm ci
npm run build

# 2. 配置 Spine 路径（或直接运行安装向导）
npm run installer        # 自动检测 Node/Spine 并写 .env

# 3. 验证
node dist/index.js check
node dist/index.js info "D:/projects/hero/hero-pro.spine"
```

也可在本目录复制 [.env.example](.env.example) 为 `.env`，填写本机实际的 `SPINE_EXE` 路径。进程环境变量可覆盖 `.env` 中的配置。

## 🤖 配置到 AI 客户端

把以下配置加入 Trae / Cursor / Claude Desktop 的 MCP 服务器配置：

示例假设本项目位于 `D:/Workspace/art-mcp-skills`；将 `args` 和 `SPINE_EXE` 替换为实际绝对路径。

```json
{
  "mcpServers": {
    "spine-mcp": {
      "command": "node",
      "args": ["D:/Workspace/art-mcp-skills/spine-mcp-server/dist/index.js", "mcp"],
      "env": { "SPINE_EXE": "D:/Applications/Spine/Spine.com", "SPINE_VERSION": "3.8" }
    }
  }
}
```

`SPINE_VERSION` 默认为 `3.8`。已有工程先只读识别版本，再固定实际编辑器补丁完成整次操作；新建工程使用 JSON 的版本。需要固定补丁时，可指定 `3.8.75`、`3.8.99` 等同系列版本。跨系列输入会拒绝，不会隐式升级工程。

调用 `spine_get_capabilities` 可查询当前能力：`{}` 列出全部适配器，`{"version":"4.2"}` 查看预留状态，`{"projectPath":"D:/art/hero.spine"}` 查看工程版本。完整设计和后续接入步骤见 [多版本架构](docs/VERSION_ARCHITECTURE.md)。

> ⚠️ 若 MCP 连接后显示 "No tools yet"，请重启 AI 客户端让服务器进程重新拉起。

## 🧩 工具一览（85 个）

| 分类 | 工具 |
|---|---|
| 信息查询 (10) | get_capabilities · get_project_info · inspect_json · describe · list_animations · list_events · list_constraints · get_attachments · get_animation_detail · render_preview |
| 骨架结构 (10) | control_bone · add_bone · delete_bone · set_bone · mirror_bones · add_slot · delete_slot · set_slot · rename_slot · batch_rename |
| 附件与皮肤 (7) | set_attachment · add_attachment · delete_attachment · set_attachment_transform · edit_mesh · set_skin · import_skin |
| 约束 (9) | add/set/delete × {ik, transform, path} |
| 动画 (19) | add_simple_animation · generate_animation · list_effects · apply_effect · pose_to_animation · mirror_animation · mix_animations · mesh_wave · export_sheet · duplicate/delete/rename_animation · set_animation_settings · control_slot · control_constraint · add_event_keyframe · set_draw_order · set_curve · export_video |
| 工作流 (2) | check_project · pipeline |
| 图集与项目 (9) | split_atlas · repack_atlas · import_image · export · import · clean · create_project · scale_project · rollback |
| Cocos 工具链 (5) | list_cocos_assets · validate_references · build_skeleton · cut_parts · assemble |
| 后台编辑 (4) | rebuild_project · edit_animation · edit_keyframes · batch_edit |
| 日常编辑 (7) | get_mesh · edit_weights · deform_mesh · cloth_motion · edit_events · animation_range · manage_attachment |
| 外部工具 (3) | pack_atlas · generate_mesh · auto_weights |

## 🧪 测试

```bash
npm test             # 构建、单元、编辑事务与 MCP 协议测试，无需 Spine 安装
npm run test:all     # 单元 + 编辑事务 + MCP 协议 + CLI 集成
npm run test:unit    # 单元测试（node:test）
```

当前自动验证：`npm test`（单元、编辑事务与 MCP 协议）及 `npm run test:rebuild`（真实 CLI）。原有外部素材套件见 `npm run test:legacy`。

## 📚 文档

- [外部工具：官方打包、自动网格与自动权重](docs/EXTERNAL_TOOLS.md)
- [日常编辑：布料、权重、事件与动画片段](docs/DAILY_OPERATIONS.md)
- [多版本架构与 Spine 4.2 接入计划](docs/VERSION_ARCHITECTURE.md)
- [用户手册 (中文)](docs/USER_MANUAL.md)
- [User Manual (EN)](docs/USER_MANUAL.en.md)

## 🗂 项目结构

```
├── src/                  # 源码（TS）
│   ├── server.ts         # MCP stdio 服务器
│   ├── spine/            # 核心：cli-executor / json-handler / export / import / render / split ...
│   │   ├── adapters/     # 版本注册表、接口、3.8 实现及 4.2 预留
│   │   └── project-context.ts # 工程版本解析与事务隔离
│   ├── tools/            # 85 个工具（registry.ts 注册）
│   └── utils/            # 配置 / 日志 / 错误码 / 文件工具
├── scripts/              # 安装向导 / 外部工具安装 / 手册生成
├── tests/                # 全部测试套件
└── docs/                 # 文档
```

## 来源

导入自 [milesmou/spine-mcp-server](https://github.com/milesmou/spine-mcp-server)，对应提交 [`edf9724`](https://github.com/milesmou/spine-mcp-server/commit/edf9724d5661d00366d6b11009b955ab930a41c7)。本目录作为 `art-mcp-skills` 的普通子目录维护。

## 📄 License

MIT
后台编辑、重建事务与新增工具详见 [日常编辑文档](docs/HEADLESS_EDITING.md)。
