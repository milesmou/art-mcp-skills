# Spine 多版本架构

当前已完成架构拆分，生产功能仍为 **Spine 3.8.x**。**4.2 仅注册为 planned**，尚未实现其工程读取、编辑、重建、物理约束或预览。升级工程的迁移工具也尚未实现。

## 分层与职责

```text
MCP 工具入口
  → 能力检查（tool-capability.ts）
  → 工程执行上下文（project-context.ts / execution-context.ts）
  → 通用事务（锁、摘要、备份、临时工程、回读、原子替换）
  → 版本注册表（adapters/registry.ts）
      ├── 3.8：runtime / JSON 校验与比较 / CLI 设置 / 官方预览
      └── 4.2：预留，拒绝尚未实现的能力
```

- `adapters/types.ts` 定义适配器契约和能力名称；注册表按主次版本选择适配器，补丁版本不新增一份实现。
- `adapters/v38/` 保存 3.8 的 CLI 导出设置、导入参数、无窗口 runtime、重建校验和官方预览。公共服务保留原来的调用接口，转发到当前适配器。
- `runtime-core.ts` 记录骨架数据所属适配器，采样使用同一 runtime。3.8 core 与 canvas 在各自的 VM 中加载，不写入 `globalThis.spine`。
- 原生 JSON 保持自身结构，不转换成一份假想的“3.8 通用格式”。FFD 路径等存在版本差异的语义由适配器提供。现有大部分编辑算法仍属于 3.8，能力名 `legacy.edit` 明确表示这些算法不能直接用于后续版本。
- 通用服务负责事务，不负责版本迁移，也不因 4.2 能读取部分字段而宣称能编辑整个工程。

## 一次操作使用一个上下文

`ProjectExecutionContext` 只读记录：工程路径、原始版本、主次版本、编辑器补丁、CLI 路径、超时和适配器。使用 `AsyncLocalStorage` 在异步调用中传递；不修改全局 `configManager` 来切换版本。

1. 已有 `.spine` 通过 `-u project -i` 只读探测原始版本和实际启动版本。启动器版本不会当成工程版本。该探测依赖支持 `-u project` 的 Spine 启动器及相应许可证/版本安装，失败时终止操作。
2. JSON 直接读取 `skeleton.spine`。只查询版本、解析 JSON 或进行 runtime 采样无需启动 CLI。新建工程若 JSON 只有 `3.8`，先只读探测实际补丁，再固定执行。
3. 默认系列配置跟随工程；显式补丁（例如 `SPINE_VERSION=3.8.75`）允许在同一主次版本内覆盖。跨系列配置冲突报 `E_VERSION_CONFLICT`。补丁覆盖是否能导入具体数据，仍须通过 CLI 和回读验证。
4. 同一次导出、导入、重建、回读统一传递精确补丁。CLI 若报告启动了另一补丁，事务失败；运行中修改全局配置不会影响已经建立的上下文。
5. 临时工程沿用当前上下文。嵌套处理另一工程时建立新的上下文，完成后恢复外层；不同异步任务互不修改版本。
6. 每份导入和回读 JSON 都检查所属主次版本。修改 `skeleton.spine` 不能跨版本重建。

重建结果增加 `execution`，包含 `family`、`sourceVersion`、`editorVersion`，便于定位实际使用的编辑器。保留既有结果字段。

## 查询能力

版本能力查询使用 `spine_get_capabilities`。包含三个外部工具集成入口后，总工具数为 **85**：

```json
{}
```

列出全部注册适配器。也可查询版本或工程，两个参数不能同时传：

```json
{"version":"4.2.75"}
```

```json
{"projectPath":"D:/art/hero.spine"}
```

返回 `family`、`status` 和每项能力的 `supported/reason`。JSON 元数据查询不运行编辑器；原生工程需要上述只读 CLI 探测。未注册版本返回 `recognized=false`。

| 能力 | 3.8 | 4.2 当前状态 |
|---|---|---|
| `metadata.read` | 支持 | 支持查询版本及能力 |
| `project.read/export/rebuild/clean` | 支持 | 拒绝 |
| `runtime.sample/preview` | 支持；预览还依赖图集和可选 canvas | 拒绝 |
| `legacy.edit` | 支持现有编辑算法 | 拒绝 |
| `mesh.inspect/weights/deform` | 支持现有普通/加权 mesh 操作 | 拒绝 |
| `animation.cloth/range/curves` | 支持现有操作 | 拒绝 |
| `events.edit`、`attachment.manage` | 支持现有操作 | 拒绝 |
| `physics.preserve/edit` | 无 4.2 物理约束能力 | 拒绝，待独立实现和验证 |

“支持”表示对应功能已接入适配器，不意味着每种输入都能成功。工具自身的网格类型、引用、关键帧和碰撞检查仍然生效。备份恢复属于文件操作，不解释 JSON，可独立于版本适配器使用。

错误分为：未注册版本 `E_UNSUPPORTED_VERSION`、未开放能力 `E_UNSUPPORTED_CAPABILITY`、版本冲突 `E_VERSION_CONFLICT`。不降级到其他版本的 runtime 或导入器。

## 后续实现 4.2 的顺序

1. **独立接入和样本。** 新建 `adapters/v42/`，加入 4.2 runtime 与对应导入导出实现，保留许可证。建立 4.2 的多骨架、FPS、皮肤、关联附件、sequence、物理约束等固定样本。若需要不同安装目录，在上下文解析处增加按系列选择 CLI 的配置；现阶段仍使用一个 Spine 启动器。
2. **先验证不修改的重建。** 实现 4.2 原生 JSON 校验和回读比较，明确哪些字段能保留，哪些必须拒绝。覆盖绑定、网格、权重、FFD、约束、事件、时间轴和曲线。通过前不开放 `project.rebuild`，不能仅以“导入未报错”为成功。
3. **逐项开放编辑。** 将现有通用操作需要的版本语义提取为适配器方法。4.2 的时间轴、附件动画、插值和继承等按原生格式实现；每项完成再启用相应能力。不要一次性把 `legacy.edit` 全部标为支持。
4. **运行时和物理。** `runtime.sample` 与 `preview.renderFrame` 使用 4.2 自己的实现。带物理的动画需要明确 reset、固定时间步长、按时间顺序推进、预热和循环收敛策略；不能照搬 3.8 的任意时间单帧采样。物理数据保留、修改、采样分别验证后再开放。
5. **独立迁移入口。** 显式传源版本、目标版本和新输出路径，输出差异报告并验证。默认不覆盖原工程；跨系列升级或降级不藏在日常编辑中。
6. **回归与启用。** 保留 3.8 原有测试，新增 4.2 单元、协议、真实 CLI 和采样/预览基准；版本能力矩阵与实现一起更新。

## 保留范围与验证

事务仍使用排他锁、摘要检查、完整骨架导出、临时工程、回读校验、备份及同目录原子替换。3.8 校验器拒绝已知不能处理的顶层结构和时间轴。未知字段不能仅因 runtime 忽略它就被视为已保留；扩展适配器时必须补充校验和差异比较。

JSON 不包含的编辑器文件夹、视图等信息，依赖原始 `.spine` 备份恢复。架构不会把 JSON 重建等同于编辑器工程的完整无损往返。

验证入口：`npm test` 覆盖能力、并发上下文、版本冲突、拒绝写入和 MCP 协议；`npm run test:rebuild` 用真实 3.8 CLI 验证多骨架、24 FPS 和日常编辑回归。

参考：[Spine 版本管理](https://esotericsoftware.com/spine-versioning)、[命令行](https://esotericsoftware.com/spine-command-line-interface)、[4.2 runtime JSON 读取器](https://github.com/EsotericSoftware/spine-runtimes/blob/4.2/spine-ts/spine-core/src/SkeletonJson.ts)。
