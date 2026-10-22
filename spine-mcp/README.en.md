# 🦴 Spine MCP

[![中文](https://img.shields.io/badge/lang-中文-red)](README.md) [![EN](https://img.shields.io/badge/lang-EN-blue)](README.en.md)

> AI-driven Spine 3.8 animation workflow server — lets AI clients (Trae / Cursor / Claude Desktop) directly control Spine.

[![Node](https://img.shields.io/badge/Node-%3E%3D20-339933)](https://nodejs.org) [![Spine](https://img.shields.io/badge/Spine-3.8-yellow)](https://esotericsoftware.com) ![License](https://img.shields.io/badge/License-MIT-blue)

---

## 📖 Overview

**Spine MCP** is a server built on the [MCP (Model Context Protocol)](https://modelcontextprotocol.io) that wraps **Spine 3.8 Professional** editor capabilities into **85 MCP tools**, allowing AI clients to directly:

- Read Spine projects (bones, slots, skins, animations, events, constraints)
- Modify animation keyframes (rotation, translation, scale, shear, curves)
- Edit skeleton structure (add/delete bones, slots, attachments, skins, outfit swapping)
- Manipulate constraints (IK, transform, path) and meshes (FFD deformation)
- Split atlases (extract parts from character illustrations), auto-rig, repack atlases
- Render animation preview frames via JS runtime

## ✨ Features

| Capability | Description |
|---|---|
| 85 MCP Tools | Covers the main Spine domains (info, skeleton, attachments, constraints, animation, atlas, project) |
| External tools | Official CLI atlas packing, automatic meshes, and libigl BBW weights; install weight dependencies with `npm run setup:external` |
| Round-Trip Modification | Export JSON → Modify → In-place import, **automatic backup** (`.bak`) |
| Version Adapters | 3.8.x is supported; 4.2 is a planned adapter with metadata and capability queries only |
| Headless editing (4) | rebuild_project · edit_animation · edit_keyframes · batch_edit |
| Installer Wizard | One-click environment detection + config writing |

## 🔧 Requirements

- **Node.js ≥ 20** (tested on v22)
- **Spine.com** (3.8 Professional, e.g. `D:\Applications\Spine\Spine.com`)

## 🚀 Quick Start

```bash
# 1. Install dependencies + build
npm install
npm run build

# 2. Configure Spine path (or run the installer wizard)
npm run installer        # Auto-detect Node/Spine and write .env

# 3. Verify
node dist/index.js check
node dist/index.js info "D:/projects/hero/hero-pro.spine"
```

## 🤖 MCP Config

Add the following configuration to your Trae / Cursor / Claude Desktop MCP server settings:

```json
{
  "mcpServers": {
    "spine-mcp": {
      "command": "node",
      "args": ["D:/Workspace/art-mcp-skills/spine-mcp/dist/index.js", "mcp"],
      "env": { "SPINE_EXE": "D:/Applications/Spine/Spine.com", "SPINE_VERSION": "3.8" }
    }
  }
}
```

`SPINE_VERSION` defaults to `3.8`. Existing projects are probed read-only and the actual editor patch is pinned for the whole operation. An explicit patch such as `3.8.75` or `3.8.99` overrides within the same version family. Cross-family inputs are rejected; no implicit project migration occurs.

Use `spine_get_capabilities` with `{}`, `{"version":"4.2"}`, or `{"projectPath":"D:/art/hero.spine"}` to query adapter support. See the [version architecture and 4.2 roadmap (Chinese)](docs/VERSION_ARCHITECTURE.md).

> ⚠️ If MCP shows "No tools yet", restart your AI client to allow the server process to reload.

## 🧩 Tools (85)

| Category | Tools |
|---|---|
| Information (10) | get_capabilities · get_project_info · inspect_json · describe · list_animations · list_events · list_constraints · get_attachments · get_animation_detail · render_preview |
| Skeleton Structure (10) | control_bone · add_bone · delete_bone · set_bone · mirror_bones · add_slot · delete_slot · set_slot · rename_slot · batch_rename |
| Attachments & Skins (7) | set_attachment · add_attachment · delete_attachment · set_attachment_transform · edit_mesh · set_skin · import_skin |
| Constraints (9) | add/set/delete × {ik, transform, path} |
| Animation (19) | add_simple_animation · generate_animation · list_effects · apply_effect · pose_to_animation · mirror_animation · mix_animations · mesh_wave · export_sheet · duplicate/delete/rename_animation · set_animation_settings · control_slot · control_constraint · add_event_keyframe · set_draw_order · set_curve · export_video |
| Workflow (2) | check_project · pipeline |
| Atlas & Project (9) | split_atlas · repack_atlas · import_image · export · import · clean · create_project · scale_project · rollback |
| Cocos Toolchain (5) | list_cocos_assets · validate_references · build_skeleton · cut_parts · assemble |
| Headless editing (4) | rebuild_project · edit_animation · edit_keyframes · batch_edit |
| Daily editing (7) | get_mesh · edit_weights · deform_mesh · cloth_motion · edit_events · animation_range · manage_attachment |
| External tools (3) | pack_atlas · generate_mesh · auto_weights |

## 🧪 Tests

```bash
npm run test:all     # Unit + editing transactions + MCP protocol + CLI integration
npm run test:unit    # Unit tests only (node:test)
```

Current checks: `npm test` (unit, editing transactions and MCP protocol) and `npm run test:rebuild` (real CLI). Legacy fixture suites: `npm run test:legacy`.

## 📚 Docs

- [Daily editing: cloth, weights, events and animation ranges (中文)](docs/DAILY_OPERATIONS.md)
- [User Manual (EN)](docs/USER_MANUAL.en.md)
- [User Manual (中文)](docs/USER_MANUAL.md)


## 🗂 Project Structure

```
├── src/                  # Source code (TypeScript)
│   ├── server.ts         # MCP stdio server
│   ├── spine/            # Core: cli-executor / json-handler / export / import / render / split ...
│   ├── tools/            # 85 tools (registered in registry.ts)
│   └── utils/            # Config / logger / error codes / file utilities
├── scripts/              # Installer wizard / external tool setup / manual generation
├── tests/                # All test suites
└── docs/                 # Specs, manuals, progress
```

## 💰 Support

Available on the [Swarms Marketplace](https://swarms.world/agent/c44211d8-0ed5-4948-8c4e-10e63f465bc3)

## 📄 License

MIT
See [headless editing and rebuild transactions](docs/HEADLESS_EDITING.md) and [official atlas packing, automatic meshes and BBW weights](docs/EXTERNAL_TOOLS.md). The latter adds `spine_pack_atlas`, `spine_generate_mesh`, and `spine_auto_weights`.
