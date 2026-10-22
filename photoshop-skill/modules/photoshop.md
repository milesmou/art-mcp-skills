# Photoshop UXP

本技能的脚本模板、API 参考和运行工具均在工程内维护，不依赖用户目录中的其他 skill。Photoshop 23.5+ 可运行 `.psjs`；具体 DOM 方法仍需核对版本支持。

## 默认执行流程

1. 明确目标文档：用户给路径就按路径打开或复用相同文档；指向当前文档时先检查是否存在，不自动新建。多个候选时根据路径和 ID 确定目标。
2. 编写任务脚本正文。启动器会将其插入 [harness.psjs](../assets/harness.psjs)，正文可以直接使用 `app`、`action`、`constants`、`fs`、`bp`、`readback`、`emit`、`withHistory`、`getRunFolder` 和 `reportProgress`。不要重复粘贴整个 harness。
3. 使用 [run_uxp.py](../scripts/run_uxp.py) 生成并启动 `.psjs`，等待与本次 `run_id` 匹配的最终状态。具体命令见 [脚本运行](../references/running-scripts.md)。
4. 阅读 `state.json` 并查看 `preview.jpg` 或实际导出 PNG；仅有 `errors: []` 不能证明画面正确。有视觉差异时只修正相关部分。

## UXP 执行约定

- `.psjs` 自带 modal 环境，直接调用 DOM/`batchPlay`，不套 `core.executeAsModal`。插件方式才按插件要求创建 modal scope。
- 优先 DOM；未覆盖的 Photoshop 功能用 actionJSON 与 `batchPlay`。需要修改状态的异步方法逐一 `await`；不要通过并发调用争用 Photoshop 状态。
- harness 的 `bp` 会记录 Photoshop 返回的错误，并在默认情况下抛出异常；明确需要逐项容错时设置 `{ strict: false }`，检查结果后再继续。
- 编辑用户已打开的文档时，使用副本或非破坏性图层，并用 `withHistory(doc, name, fn)` 将多步修改合为一次撤销。它在失败时回滚对应文档的修改。
- 输出预览使用 `await emit(doc, extra)`，以副本方式保存；运行状态包含文档、图层、错误和运行 ID。任务正文即使抛异常，harness 也会尝试写出失败状态。
- `console.log` 的输出不作为外部完成信号。只信任启动器收集到的本次最终状态；超时不代表 Photoshop 中的脚本停止，不直接重新启动同一批任务。

## 文档与文件保护

- 保留用户已有文档的内容、保存状态和打开状态，不覆盖源文件。工作结果留在 Photoshop 中供检查；只自动关闭本次任务的临时文档和约定的批处理输入。
- 用图层 ID、完整层级路径和目标文档 ID 定位对象；复制文档后重新建立映射，避免重名图层或切换标签造成误操作。
- UXP 文件访问使用 storage entry；actionJSON 引用外部文件时使用 session token。不要混用 ExtendScript 的 `File`、`Folder`、`UnitValue` 或 Node.js 文件 API。
- 需要无交互输出时，先写入 `await getRunFolder()` 下的临时文件，启动器结束后会整体收集到运行目录的 `output/`。随后用本地文件工具将交付素材放到用户指定目录，基础检查也在 Photoshop 外集中进行。
- 从实际预览判断文字可见性、裁切边缘、蒙版、颜色和图层效果。对 PNG 在首次写出时配置无损压缩，避免导出后逐张重新打开处理。

## 按需参考

- [脚本运行](../references/running-scripts.md)：Windows/macOS 启动、准备模式、超时后的收集。
- [读取结果](../references/reading-results.md)：运行状态、预览、图层快照与底层属性回读。
- [图层与合成](../references/layers-and-composition.md)：文字、形状、填充、蒙版、调整层、智能对象和变换。
- [batchPlay](../references/batchplay.md)：actionJSON、目标引用和结果检查。
- [常见问题](../references/gotchas.md)：modal、历史状态、文件访问、坐标和版本。
