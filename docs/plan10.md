# 截图功能最终方案：屏幕内联调整与编辑态

## 目标

采用 QQ / 微信 / ShareX 这类专业区域截图工具的标准交互：截图过程停留在屏幕内联 overlay 中完成，不弹独立大预览窗。

当前阶段先实现标准流程骨架：

- 鼠标拖拽创建选区。
- 鼠标松开后不立刻截图，而是进入选区调整态。
- 调整态可以拖动 8 个边界/角点调整大小。
- 调整态可以按住选区内部整体移动位置。
- 选区下方显示小工具栏。
- 工具栏包含：画笔、重截、取消、发送。
- 画笔按钮本阶段只负责切换到 Editing 状态，不实现真实绘制。
- 点击发送后才截图、保存 PNG、返回聊天输入框图片附件。
- 不再显示 `ScreenshotPreviewModal` 这类外围预览窗口。

## 参考原则

- Win32 鼠标拖拽应使用 `SetCapture` / `ReleaseCapture` 保证拖拽期间持续接收鼠标输入。
- 成熟区域截图工具把截图作为一个完整交互模式处理，而不是 mouseup 后立即输出。
- ShareX/QQ/微信类做法更符合本项目目标：屏幕内联调整、内联工具栏、确认后输出。
- Windows Snipping Tool / Greenshot 偏向“截图后进入编辑器”，不作为本项目第一目标。

参考：

- Microsoft `SetCapture`: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setcapture
- Microsoft `ReleaseCapture`: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-releasecapture
- ShareX Region Capture: https://getsharex.com/docs/region-capture

## 标准状态机

```text
Idle
  -> Selecting          鼠标拖拽创建初始选区
  -> Adjusting          mouseup 后进入，可移动/缩放选区
  -> Moving             Adjusting 中按住选区内部拖动
  -> Resizing           Adjusting 中拖动 8 个边界/角点
  -> Editing            点击任意编辑工具后进入，选区几何锁定
  -> Confirmed          点击发送
  -> Cancelled          Esc / 取消
```

### 关键规则

- `mouseup` 不是截图完成，只是确认初始选区并进入 `Adjusting`。
- `Adjusting` 时仍然显示半透明暗层，选区内部保持亮区。
- `Adjusting` 时显示 8 个 resize handle。
- `Adjusting` 时选区内部可拖动移动。
- 点击任意编辑按钮后进入 `Editing`。
- 进入 `Editing` 后选区几何锁定：
  - 不能再拖 8 个边界。
  - 不能再移动选区。
  - 鼠标事件只属于编辑工具。
  - 工具栏保留取消、发送，以及编辑相关按钮。
- 当前阶段的画笔按钮只切换到 `Editing`，不产生笔迹。
- 点击 `发送` 才关闭 overlay、等待 100ms、调用 xcap 截最终区域。

## UI 标准

### Overlay

- 使用 Rust/Win32 原生 overlay，不再使用 Tauri WebView overlay。
- overlay 覆盖主显示器。
- overlay 是截图交互层，不是普通应用窗口。
- 不显示标题栏、边框、系统窗口按钮。
- 选区外部绘制半透明暗层。
- 选区内部显示真实屏幕内容或透明亮区。
- 选区边框使用蓝色高亮。
- 8 个控制点分布在四角和四边中点。

### 工具栏

工具栏不是独立窗口，也不是 React modal；它是 overlay 内绘制的浮动工具栏。

第一阶段工具栏按钮：

```text
画笔 | 重截 | 取消 | 发送
```

布局规则：

- 默认显示在选区下方。
- 如果选区靠近屏幕底部，自动显示在选区上方。
- 工具栏必须 clamp 到屏幕范围内。
- 工具栏不应该遮挡 8 个 resize handle。
- 工具栏按钮命中区域要足够大，避免误触。

### 不再使用的 UI

- 不再弹出 `ScreenshotPreviewModal` 大预览窗口。
- 不再显示外围白色预览容器。
- 不再有截图完成后的独立预览背景。

截图完成后的结果应该直接进入聊天输入框图片附件区。

## 交互细节

### Selecting

触发条件：

- 点击聊天工具栏剪刀按钮。

行为：

- 创建原生 overlay。
- 鼠标按下后记录起点。
- 鼠标移动时更新当前点。
- 绘制选区边框和暗层。
- 鼠标松开：
  - 如果宽高小于 8px，取消或回到待选状态。
  - 如果有效，进入 `Adjusting`。

### Adjusting

进入条件：

- `Selecting` 阶段 mouseup 后，选区有效。

行为：

- 不截图。
- 不关闭 overlay。
- 不弹预览窗。
- 绘制：
  - 暗层
  - 亮区
  - 蓝色边框
  - 8 个 handle
  - 浮动工具栏

命中区域：

```text
top-left
top
top-right
right
bottom-right
bottom
bottom-left
left
inside
toolbar-button
outside
```

鼠标行为：

- 命中 handle：切换对应 resize 光标。
- 拖动 handle：进入 `Resizing`。
- 命中 inside：切换 move 光标。
- 拖动 inside：进入 `Moving`。
- 命中 toolbar：执行按钮动作。
- 命中 outside：第一阶段不重新选区，避免误操作；后续可支持点击外部重选。

### Moving

进入条件：

- Adjusting 中按住选区内部拖动。

行为：

- 维持选区宽高不变。
- 根据鼠标移动偏移更新 `left/top`。
- 将选区 clamp 到显示器边界内。
- mouseup 后回到 `Adjusting`。

### Resizing

进入条件：

- Adjusting 中按住 8 个 handle 之一拖动。

行为：

- 根据当前 handle 修改对应边界。
- 允许反向拖动时自动规范化 rect。
- 最小宽高为 8px。
- 选区 clamp 到显示器边界内。
- mouseup 后回到 `Adjusting`。

### Editing

进入条件：

- 点击工具栏中的任意编辑工具。
- 当前阶段只有 `画笔` 按钮。

当前阶段行为：

- `mode = Editing`
- `selectionLocked = true`
- `activeTool = Pen`
- 不实现真实画笔绘制。
- 不允许移动选区。
- 不允许拖动 8 个边界。
- 工具栏仍显示：

```text
画笔(激活) | 重截 | 取消 | 发送
```

后续真实编辑能力插入点：

```text
finalRect = 当前选区
selectionLocked = true
editorCanvas = finalRect 坐标系
annotations = []
activeTool = 用户点击的工具
```

编辑态坐标转换：

```text
editorX = mouseScreenX - finalRect.left
editorY = mouseScreenY - finalRect.top
```

未来支持真实编辑后，发送时流程为：

1. 截取 `finalRect`。
2. 将 annotations 合成到 bitmap。
3. 保存 PNG。
4. 返回前端附件。

### Recut

行为：

- 清空当前 selection。
- 清空编辑态。
- 回到 `Selecting`。
- overlay 不销毁，用户可以重新拖拽。

### Cancel

触发：

- 点击取消。
- 按 Esc。

行为：

- 销毁 overlay。
- 返回 cancelled。
- 不影响聊天输入框已有内容。
- 不添加附件。

### Send

触发：

- 点击发送。

行为：

- 保存最终选区。
- 销毁 overlay。
- 等待 100ms。
- Rust/xcap 截取最终区域。
- 保存临时 PNG。
- 返回：

```ts
{
  filePath: string;
  width: number;
  height: number;
}
```

- 前端转换为附件对象。
- 加入聊天输入框待发送图片附件区。
- 不直接调用聊天发送。

## Rust 实现计划

当前已有：

- `capture_region_interactive`
- Rust/Win32 原生 overlay
- xcap 区域截图
- 返回临时 PNG 路径

下一步重构：

### 1. 扩展状态结构

新增字段：

```rust
enum OverlayMode {
    Selecting,
    Adjusting,
    Moving,
    Resizing(ResizeHandle),
    Editing,
    Confirmed,
    Cancelled,
}

enum ResizeHandle {
    TopLeft,
    Top,
    TopRight,
    Right,
    BottomRight,
    Bottom,
    BottomLeft,
    Left,
}

enum ToolButton {
    Pen,
    Recut,
    Cancel,
    Send,
}
```

状态中保存：

```rust
mode
selection_rect
drag_start
drag_origin_rect
active_handle
active_tool
toolbar_rects
selection_locked
```

### 2. 增加 hit test

实现：

```rust
hit_test(point) -> HitTarget
```

返回：

```rust
Handle(ResizeHandle)
InsideSelection
ToolbarButton(ToolButton)
Outside
```

### 3. 增加光标管理

根据 HitTarget 设置：

- corner resize cursor
- horizontal resize cursor
- vertical resize cursor
- move cursor
- crosshair cursor
- default cursor over toolbar

### 4. 改造 mouseup 行为

当前 mouseup 会完成截图。

改成：

- Selecting mouseup -> Adjusting
- Moving mouseup -> Adjusting
- Resizing mouseup -> Adjusting
- Editing mouseup -> 保持 Editing

只有点击发送才进入 Confirmed。

### 5. 绘制 8 个 handle

在 `WM_PAINT` 中绘制：

- selection border
- 8 handles
- toolbar
- active pen state

### 6. 工具栏绘制和点击

第一阶段不用图标库，原生绘制文本按钮即可：

```text
画笔  重截  取消  发送
```

后续可替换为图标。

### 7. Confirmed 后截图

Confirmed 时：

- 销毁 overlay。
- `thread::sleep(Duration::from_millis(100))`
- xcap capture region。
- 保存 PNG。
- 返回前端。

## 前端实现计划

### 1. 移除 ScreenshotPreviewModal 依赖

当前截图完成后会设置 `screenshotPreview` 并显示大预览弹窗。

下一步改为：

- `startScreenshot()` 返回 attachment 后直接加入 pending image attachments。
- 不再 `setScreenshotPreview(attachment)`。
- 不再渲染 `ScreenshotPreviewModal`。

### 2. 点击截图后的前端流程

```ts
const attachment = await startScreenshot();
if (attachment) {
  addPendingImageAttachment(attachment);
}
```

### 3. 保持现有发送逻辑

截图附件仍然复用当前 pending image attachments：

- 用户可以继续输入文字。
- 用户点击聊天输入框原本发送按钮。
- 按现有图片消息流程发送。

## 第一阶段验收标准

1. 点击剪刀进入原生截图 overlay。
2. 拖拽创建选区。
3. 鼠标松开后不弹大预览窗。
4. 鼠标松开后仍停留在 overlay。
5. 选区外部为半透明暗层。
6. 选区内部为亮区。
7. 选区显示 8 个 handle。
8. 拖动 8 个 handle 可以调整区域。
9. 按住选区内部可以整体移动。
10. 选区下方显示工具栏：画笔、重截、取消、发送。
11. 点击画笔后进入 Editing，选区不能再调整或移动。
12. 当前阶段画笔不需要真实绘制。
13. 点击重截回到 Selecting。
14. 点击取消或 Esc 关闭 overlay，不影响聊天输入。
15. 点击发送后关闭 overlay，截图进入聊天输入框图片附件区。
16. 不直接发送聊天消息。
17. 不再出现 `ScreenshotPreviewModal`。
18. 不使用 html2canvas。
19. 不传 base64 大图。
20. 不创建 WebView overlay。

## 后续阶段

真实编辑功能按以下顺序加：

1. 画笔路径
2. 箭头
3. 文字标注
4. 马赛克
5. 撤销/重做
6. 标注对象选择/移动
7. 标注合成到 bitmap

每个编辑工具都只能在 `Editing` 中工作，不允许和选区调整逻辑混用。

最终原则：

```text
先定区域，再定内容，最后输出。
```
