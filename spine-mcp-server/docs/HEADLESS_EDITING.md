# 日常编辑与后台重建

本服务支持 Spine **3.8.x** 系列，默认使用 `SPINE_VERSION=3.8`，不限定补丁版本。所有复用 `modifyProject` 的骨骼、插槽、附件、皮肤、约束和动画编辑工具，均通过 CLI 在后台重建工程，无需编辑器窗口。编辑器没有专用接口时，可使用新增的动画、关键帧和 JSON 批量编辑入口。

加权网格、布料跟随、权重、事件和动画片段的专用入口详见 [日常操作文档](DAILY_OPERATIONS.md)。

配置示例：

```json
{
  "mcpServers": {
    "spine-mcp": {
      "command": "node",
      "args": ["D:/Workspace/spine-mcp-server/dist/index.js", "mcp"],
      "env": {
        "SPINE_EXE": "D:/Applications/Spine/Spine.com",
        "SPINE_VERSION": "3.8"
      }
    }
  }
}
```

`SPINE_VERSION` 默认 `3.8`。已有工程用 `-u project -i` 只读识别版本，随后把实际编辑器补丁固定到该事务。需要显式固定补丁时，可填写 `3.8.75`、`3.8.99` 等同系列版本；CLI 仍会检查导入兼容性。`SPINE_EXE` 可配置任意安装目录。

工程编辑会先由所选 CLI 导出 JSON，再用同一版本重建。导入外部 JSON 时，是否兼容还取决于导出它的编辑器版本；若 CLI 提示数据版本不支持，请将 `SPINE_VERSION` 设置为该 JSON 的原导出版本。版本范围检查不会跳过 CLI 导入和回读校验。

现在通过版本适配器统一调度。4.2 仅预留版本和能力查询；读取、编辑、预览和重建均明确拒绝。工程升级需要未来独立的迁移入口，不能靠修改 `skeleton.spine` 完成。详见 [多版本架构](VERSION_ARCHITECTURE.md)。

## 编辑事务

1. 对目标工程加排他锁，记录文件摘要。
2. 用 Spine CLI 导出全部骨架的 JSON；多骨架工程显式选择 `skeletonName`。
3. 修改目标骨架，检查引用、时间轴、网格索引及权重。
4. 将所有骨架导入一个尚不存在的临时 `.spine`，避免旧版 CLI 向现有工程新增重复骨架。
5. 重新导出并检查骨架数量、名称、帧率、绑定、附件、权重及动画时间轴和插值。
6. 检查原工程未被外部修改，保存唯一 `.bak`，通过同目录文件重命名替换原工程。

失败时保留原工程；`spine_rollback` 可以列出和恢复备份。锁可防止多个 MCP 进程同时编辑，外部编辑器在操作期间保存文件也会导致 MCP 取消提交。

重建保留 Spine 可导出的数据。编辑器文件夹、视图等未导出信息不承诺重建保留，原始 `.spine` 备份保留这些内容。贴图、atlas 和已有 `.skel` 不会由编辑工具隐式覆盖；修改后可按需要单独导出运行时资源。图像绘制和审美判断仍依赖相应工具，重建接口提供的是数据编辑能力。

## 常用入口

| 工具 | 用途 |
|---|---|
| `spine_edit_animation` | 新增、替换或按时间轴合并完整动画，支持骨骼、插槽、FFD、约束、事件和绘制顺序 |
| `spine_edit_keyframes` | 批量写入、替换、删除或平移指定时间轴的关键帧 |
| `spine_batch_edit` | 一次导出和重建完成多项骨架/附件/动画编辑，支持条件校验 |
| `spine_rebuild_project` | 从 JSON 创建工程，替换选定骨架，或重建已有工程 |
| `spine_import_animation` | `mergeMode=update` 只导入选定动画；`replace` 替换整个目标骨架 |

四个新工具都支持 `dryRun=true`：只导出、修改和校验数据，不执行 CLI 重建、不生成备份、不替换原工程。最终是否能被编辑器完整回读，由正式提交的 CLI 重建校验确认。

### 新增 dance 动画

调用 `spine_edit_animation`，从生成的 JSON 中读取一个动作：

```json
{
  "projectPath": "D:/art/mainGirl1/女主.spine",
  "animationName": "dance",
  "mode": "create",
  "jsonPath": "D:/generated/mainGirl1-with-dance.json",
  "sourceAnimation": "dance"
}
```

`create` 遇到同名动画报错；`replace` 要求原动画存在；`merge` 按骨骼/插槽等对象递归合并，提供的完整时间轴数组替换同路径数组，其余时间轴保留。其他动画和项目内其他骨架均保留。

也可直接传 `animation` 对象，无需中间文件：

```json
{
  "projectPath": "D:/art/hero.spine",
  "animationName": "nod",
  "animation": {
    "bones": {
      "head": {
        "rotate": [{"angle":0}, {"time":0.5,"angle":15}, {"time":1,"angle":0}]
      }
    }
  }
}
```

### 调整和删除关键帧

调用 `spine_edit_keyframes`：

```json
{
  "projectPath": "D:/art/hero.spine",
  "animationName": "dance",
  "timeline": ["bones", "head", "rotate"],
  "operation": "upsert",
  "frames": [{"time":0,"angle":0}, {"time":0.5,"angle":12}]
}
```

`upsert` 合并同时间帧并自动排序；`replace` 替换整个时间轴；`delete` 删除 `startTime..endTime`（两端包含）；`shift` 将范围内关键帧平移 `offset` 秒，拒绝负时间和时间冲突。路径用数组分段，支持名称自身带点号或斜杠。

Spine 时间轴使用相对 setup 的旋转/位移偏移，缩放使用倍率。`time` 是秒，省略表示 0。标准动画 JSON 无需 `duration` 字段，时长由所有时间轴的最大时间计算。

### 一次修改多项数据

调用 `spine_batch_edit`，使用 JSON Pointer 的标准路径转义（`~1` 表示 `/`、`~0` 表示 `~`）：

```json
{
  "projectPath": "D:/art/hero.spine",
  "operations": [
    {"op":"test","path":"/bones/1/name","value":"head"},
    {"op":"add","path":"/bones/1/rotation","value":10},
    {"op":"copy","from":"/animations/idle","path":"/animations/dance"},
    {"op":"replace","path":"/animations/dance/bones/head/rotate/0/angle","value":15}
  ]
}
```

支持 `add / replace / remove / copy / move / test`。数组 `add` 插入，`/-` 追加；`replace/remove` 要求路径存在。建议先用 `test` 检查索引对应的名称，或通过原有按名称编辑的工具操作。所有步骤共享一个事务，任意步骤失败则不写入工程。骨骼重命名等涉及多处引用时，优先使用已有专用工具，或在同一批次更新全部引用。

## 验证

- `npm test`：构建、20 个原有单元测试、新增编辑/事务保护测试、3.8 系列版本兼容测试、真实 MCP stdio 协议测试，无需 Spine 安装。
- `npm run test:rebuild`：真实 CLI 集成测试，需要已激活的 Spine 3.8 系列 CLI；测试多骨架、24 FPS、动画新增及失败不覆盖。
- `npm run test:legacy`：原有基于外部示例素材的测试，仍依赖原测试机目录。
