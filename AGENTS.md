# 项目约定

本项目名为 `art-mcp-skills`，整合 Photoshop 素材处理、游戏 UI/Spine 部件切图与 Spine 角色动画制作。项目仓库为 `https://github.com/milesmou/art-mcp-skills`。

- `spine-mcp/`：来自 `https://github.com/milesmou/spine-mcp-server` 的服务源码、测试及文档。安装依赖、构建和测试在此目录执行，或在根目录使用 `npm --prefix spine-mcp ...`。
- `spine-skill/`：名为 `spine-skill` 的统一技能，`SKILL.md` 直接位于本目录。先阅读 [spine-skill/SKILL.md](spine-skill/SKILL.md)，按任务加载工程通用、骨架绑定、动画制作或预览交付模块。
- `photoshop-skill/`：名为 `photoshop-skill` 的统一技能，`SKILL.md` 直接位于本目录。先阅读 [photoshop-skill/SKILL.md](photoshop-skill/SKILL.md)，按任务加载通用 Photoshop、游戏 UI 切图或 Spine 部件切图模块。
- `spine-animation-director/`：名为 `spine-animation-director` 的动作导演技能。根据 PSD/单图和动画需求编写动作剧本、制作规范与切图补图蓝图，再统筹 Photoshop 与 Spine 执行完整制作；先阅读 [技能入口](spine-animation-director/SKILL.md)。

每个目录只维护一个技能入口，功能模块放在各自 `modules/` 中，作为按需读取的内部文档，不再嵌套同名技能目录或单独注册模块。

PSD/单图到 Spine 动画的完整任务由动作导演技能先确定剧本、规范和素材蓝图，按现有 Spine 技能完成制作前效果预演及确认后，再依次使用 Photoshop 部件切图/补图模块与 Spine 动画技能。Photoshop 交付 PNG、坐标清单和可选初始摆位 JSON，Spine 负责骨骼绑定、动画编辑、验证和运行时导出；初始摆位不代表已完成绑定。只要求切图或已有工程局部编辑时直接使用对应技能，不强制扩展为完整制作。

导出快照及临时验证产物放在根目录 `.work/`；Photoshop 素材交付默认按其技能约定放在根目录 `exports/` 的任务目录，两者均已忽略。修改文档路径时使用相对工程根目录的路径，使项目根目录改名或搬迁后仍能使用。

已验收 Spine 参考库为 `../XiaoGuan/art/spine/`（相对于本工程根目录），目录搬迁时按用户当前指定根目录定位。女主制作方法参考为该库的 `女主/mainGirl1/女主.spine`；角色动作参考按 [已验收动作索引](spine-animation-director/references/accepted-motion-library.md) 选择具体版本和动画。参考工程只读，新任务的编辑目标以用户指定路径为准。

- 使用 `git diff` 时加上 `-w`，忽略空白差异。
- 用户要求“提交 git”时，使用本地仓库的 Git 命令提交，并自动推送到当前所在的远程分支。

## 文档维护

- README 只介绍当前工程或组件的用途，并链接到具体文档；不放代理执行规则、详细操作步骤、测试命令或本机参考工程路径。
- 协作与开发约定集中在本文件；技能执行规则放在各自 `SKILL.md` 和 `modules/`；安装与使用细节放在 `docs/` 或 `references/`。
- Spine MCP 安装与客户端配置见 [用户手册](spine-mcp/docs/USER_MANUAL.md)，自动权重依赖见 [外部工具](spine-mcp/docs/EXTERNAL_TOOLS.md)。
- Spine MCP 导入自 `milesmou/spine-mcp-server` 的 `edf9724d5661d00366d6b11009b955ab930a41c7` 提交；源码、工具注册、测试分别位于 `spine-mcp/src/`、`spine-mcp/src/tools/registry.ts`、`spine-mcp/tests/`。

## 开发验证

以下命令在项目根目录执行，按修改范围选择验证：

- Spine MCP 构建：`npm --prefix spine-mcp run build`。
- 单元、编辑事务与 MCP 协议：`npm --prefix spine-mcp test`，无需安装 Spine。
- 真实 CLI 重建集成：`npm --prefix spine-mcp run test:rebuild`，需要可用的 Spine CLI。
- 外部工具集成：先执行 `npm --prefix spine-mcp run setup:external`，再执行 `npm --prefix spine-mcp run test:external`。
- 旧素材测试套件：`npm --prefix spine-mcp run test:legacy`。
- Photoshop 启动器与初始摆位生成器：`python -m unittest discover -s photoshop-skill/scripts/tests -v`，无需启动 Photoshop 或 Spine。

脚本准备模式和单元测试仅验证脚本组合与数据处理；实际编辑、切图与动画交付仍需在对应软件中执行并回读、预览检查。
