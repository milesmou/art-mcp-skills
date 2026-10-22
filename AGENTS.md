# 项目约定

本项目名为 `art-mcp-skills`，整合 Photoshop 素材处理、游戏 UI/Spine 部件切图与 Spine 角色动画制作。项目仓库为 `https://github.com/milesmou/art-mcp-skills`。

- `spine-mcp/`：来自 `https://github.com/milesmou/spine-mcp-server` 的服务源码、测试及文档。安装依赖、构建和测试在此目录执行，或在根目录使用 `npm --prefix spine-mcp ...`。
- `spine-skill/`：名为 `spine-skill` 的统一技能，`SKILL.md` 直接位于本目录。先阅读 [spine-skill/SKILL.md](spine-skill/SKILL.md)，按任务加载工程通用、骨架绑定、动画制作或预览交付模块。
- `photoshop-skill/`：名为 `photoshop-skill` 的统一技能，`SKILL.md` 直接位于本目录。先阅读 [photoshop-skill/SKILL.md](photoshop-skill/SKILL.md)，按任务加载通用 Photoshop、游戏 UI 切图或 Spine 部件切图模块。

每个目录只维护一个技能入口，功能模块放在各自 `modules/` 中，作为按需读取的内部文档，不再嵌套同名技能目录或单独注册模块。

PSD 到 Spine 动画的完整任务依次使用 Photoshop 部件切图模块与 Spine 动画技能。前者交付 PNG、坐标清单和可选初始摆位 JSON，后者负责骨骼绑定、动画编辑、验证和运行时导出；初始摆位不代表已完成绑定。

导出快照及临时验证产物放在根目录 `.work/`；Photoshop 素材交付默认按其技能约定放在根目录 `exports/` 的任务目录，两者均已忽略。修改文档路径时使用相对工程根目录的路径，使项目根目录改名或搬迁后仍能使用。

Spine 参考工程为 `D:/Workspace/XiaoGuan/art/spine/女主/mainGirl1/女主.spine`。它是制作方法的参考；新任务的编辑目标以用户指定路径为准。

- 使用 `git diff` 时加上 `-w`，忽略空白差异。
- 用户要求“提交 git”时，使用本地仓库的 Git 命令提交，并自动推送到当前所在的远程分支。
