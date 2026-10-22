# 读取执行结果

Photoshop 中的 `console.log` 不作为外部回传通道。工程内置 harness 将结果写入 UXP 临时存储中独立的 `<run_id>/`，启动器找到匹配的完成标记后一次收集整个目录到运行目录的 `output/`。

## 输出约定

| 文件 | 用途 |
| --- | --- |
| `progress.json` | 脚本内通过 `reportProgress(phase, extra)` 更新的运行阶段；不代表完成 |
| `state.json` | 最后写出的终态，含 `run_id`、`status`、`elapsed_ms`、`photoshop_version` 和 `errors` |
| `preview.jpg` | `emit(doc, extra)` 以副本方式保存的视觉预览 |
| 其他任务文件 | 写在 `await getRunFolder()` 中的 PNG、资源清单等，随结果一起收集 |

`emit` 在内存中记录文档信息、递归图层结构及附加数据，并写出预览；任务结束后 harness 再写出最终 `state.json`。没有可预览文档的探测任务可以只写状态。异常结束时可能只有失败状态或部分产物，应检查错误再决定如何恢复。

运行 ID 和终态字段由 harness 决定，任务附加数据不能将失败改写为成功。过期结果文件和上次任务的预览不能用于确认本次任务。

## 结构化回读

`snapshotLayer` 自动包含 ID、名称、类型、可见性、透明度、混合模式、边界和子图层；文字图层还包含文字内容和可获得的颜色。`emit` 结果同时保存文档 ID、名称、宽高和 DPI。

DOM 没有暴露的属性可通过 `readback` 查询：

```javascript
const target = [
    { _ref: "layer", _id: layer.id },
    { _ref: "document", _id: doc.id },
];
const values = await readback(target, ["bounds", "layerID", "layerEffects"], "inspect target");
await emit(doc, { readback: values });
```

底层 Action Manager 值可能带单位包装，例如 `{ _unit: "pixelsUnit", _value: 100 }`；读取 `_value`，不要直接当数字。底层透明度可能是 0–255，不能套用 DOM 的 0–100 阈值。

## 视觉检查

先读取 `state.json`，再用图像查看工具查看预览及代表性 PNG。错误数组为空只说明没有被记录的执行错误，不能证明文字颜色正确、资源未被遮挡、蒙版完整或裁切边缘正确。

任务产物优先先写 UXP 临时目录，再由本地文件工具整理到交付目录。PNG 的尺寸、Alpha、文件名和重复项在 Photoshop 外集中检查，不将所有导出图重新打开到 Photoshop 做基础校验。

在 Windows 和 macOS 上都由启动器搜索 UXP 存储路径，不硬编码 Photoshop 版本或 `External` 编号。如果使用手动启动方式，使用运行描述中的 ID，并仅查找包含该 ID 的结果目录。
