# 运行工程内置 UXP 脚本

需要 Python 3.10+ 和正在运行的 Photoshop 23.5+。启动器仅使用 Python 标准库。Windows 自动读取当前 Photoshop 进程的可执行路径，macOS 自动发现唯一的 Photoshop 应用；多个版本时使用 `--photoshop` 明确指定。

## 标准命令

以下命令从工程根目录执行；脚本与运行目录可使用绝对路径。

```powershell
# 读取当前文档并生成预览，不修改设计稿
python photoshop-skill/scripts/run_uxp.py photoshop-skill/scripts/probe.psjs

# 用临时文档验证编辑、历史状态和 PNG 导出，完成后自动关闭临时文档
python photoshop-skill/scripts/run_uxp.py photoshop-skill/scripts/smoke.psjs

# 执行任务正文；启动器会自动加入 harness
python photoshop-skill/scripts/run_uxp.py D:/tasks/task-body.psjs --timeout 90

# 指定运行中的 Photoshop 安装位置
python photoshop-skill/scripts/run_uxp.py D:/tasks/task-body.psjs --photoshop "C:/Program Files/Adobe/Adobe Photoshop 2023/Photoshop.exe"
```

年份只用于最后一条显式路径示例，自动发现没有固定版本。macOS 的 `--photoshop` 值为 `.app` 路径。Windows 将生成的 `.psjs` 作为文件参数发给 Photoshop；macOS 使用 `open -a`。二者都以实际写出的结果文件确认完成，不把启动命令返回当作任务成功。

## 编写任务正文

正文直接使用 harness 已提供的模块和函数，可以使用顶层 `await` 或 `return`。例如：

```javascript
if (!app.documents.length) throw new Error("No document open");
const doc = app.activeDocument;
await emit(doc, { note: "Read current document" });
```

原始模板 [harness.psjs](../assets/harness.psjs) 中保留两个构建标记，不能直接在 Photoshop 中打开它；由 [run_uxp.py](../scripts/run_uxp.py) 替换标记后生成可执行脚本。

```powershell
# 只生成，不启动；可检查生成的脚本，或通过 Photoshop 的脚本菜单运行它
python photoshop-skill/scripts/run_uxp.py D:/tasks/task-body.psjs --prepare-only
```

## 结果和恢复

- 默认运行目录为系统临时目录下 `photoshop-uxp-runs/<run_id>/`，包含生成的 `task.psjs`、运行描述 `run.json`，结束后有 `output/`。
- 标准输出为包含运行 ID、状态、结果目录、状态文件路径、脚本内耗时和错误的 JSON。退出码：`0` 完成、`1` 脚本失败、`2` 启动器错误、`124` 等待超时。
- `--run-dir` 可指定新的或空的运行目录；非空目录会被拒绝，避免覆盖前次任务。`--search-root` 可补充特殊环境下的 UXP 存储根目录。
- 启动器只收集运行 ID 匹配、状态为 `completed` 或 `failed` 的最终结果；旧文件、尚在写入的 JSON 和运行中状态不会被当作完成。
- 默认等待 90 秒；等待超时不终止 Photoshop 脚本，也不自动切换引擎。未获得前次最终状态时，启动器保留运行锁并阻止再次启动。

```powershell
# 超时后继续等同一次运行，不重新执行脚本
python photoshop-skill/scripts/run_uxp.py --collect "C:/path/to/previous-run" --timeout 90
```

收集命令也可在已完成运行上使用。启动器会保留失败运行的预览及部分产物，便于定位问题；它不强制结束 Photoshop，也不删除源文件或结果。

`.psjs` 适合单次任务和批处理。只有需要常驻监听或插件生命周期能力时才另建 UXP 插件，本工程启动器无需安装常驻插件。
