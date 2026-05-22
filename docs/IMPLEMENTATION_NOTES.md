# 教师课程表挂件 - Implementation Notes

本文档整理从 `desktop-under-icons-widget` 验证项目迁移到正式项目 `teacher-schedule-widget` 的关键实现。

## 1. attached 模式实现方案

attached 模式用于让课程表挂件显示在 Windows 壁纸层之上、桌面图标层之下。实现路径在 `src-tauri/src/desktop_layer.rs`：

- 通过 `FindWindowA("Progman")` 找到桌面根窗口。
- 向 `Progman` 发送 `0x052C` 消息，促使 Explorer 创建或刷新 `WorkerW`。
- 枚举顶层窗口，找到包含 `SHELLDLL_DefView` 的桌面图标宿主，再取其兄弟 `WorkerW`。
- 取得 Tauri 窗口 `HWND` 后，先切换为 `WS_CHILD`，移除 `WS_POPUP`。
- 使用 `SetParent(hwnd, worker_w)` 将窗口挂载到 WorkerW。
- 使用 `SetWindowPos(..., HWND_BOTTOM, ..., SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW)` 保持当前位置和大小，并放到 WorkerW 内较低层级。
- 使用 `ShowWindow(hwnd, SW_SHOW)` 保证 Explorer 刷新后窗口仍可见。

## 2. 桌面图标下交互转发方案

attached 模式下，窗口视觉上位于桌面图标层下面，普通 DOM mouse/pointer 事件可能被 Explorer 的图标视图拦截。因此迁移了 `src-tauri/src/input_forwarder.rs`：

- 后台线程仅在 attached 标志为 true 时工作。
- 每 16ms 轮询一次 `GetWindowRect(hwnd)`、`GetCursorPos()` 和 `GetAsyncKeyState(VK_LBUTTON)`。
- 当光标进入、离开、移动或左键按下时，向前端发送 `desktop-input` 事件。
- 事件坐标是窗口内物理像素坐标。
- 前端在 `src/app/App.tsx` 中读取 `scaleFactor()`，将物理像素除以 scaleFactor 后再与 DOMRect 的 CSS 像素坐标比较。
- attached 模式下模式切换按钮和课程卡片点击都可以由转发坐标触发。

## 3. detached 普通窗口模式

detached 模式用于布局编辑：

- 调用 `detach_from_desktop_icon_layer`。
- 恢复顶层窗口样式：加入 `WS_POPUP`，移除 `WS_CHILD`。
- 使用 `SetParent(hwnd, None)` 让 Tauri 窗口回到普通顶层窗口。
- 使用 `SetWindowPos(..., HWND_TOP, ..., SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW | SWP_FRAMECHANGED)`。
- 调用 `set_resizable(true)` 和 `set_skip_taskbar(false)`。
- 调用 `set_focus()` 让用户可以直接交互。

detached 模式下 DOM hover、click、pointer 事件按普通 WebView 行为工作。

## 4. 模式切换

模式切换命令在 `src-tauri/src/window_mode.rs`：

- `switch_to_attached`
- `switch_to_detached`
- `get_window_mode`

前端模式按钮在 detached 下走普通 DOM click。在 attached 下，按钮可能收不到 DOM click，因此前端同时监听 Rust 转发的 `desktop-input`，用转发坐标命中按钮区域并调用同一套切换命令。

## 5. detached 下移动/缩放

detached 模式渲染两个编辑热区：

- 顶部 `drag-strip` 调用 `getCurrentWindow().startDragging()`。
- 右下角 `resize-grip` 调用 `getCurrentWindow().startResizeDragging("SouthEast")`。

移动和缩放交给 Tauri/Windows 原生窗口管理处理，避免手写拖拽坐标。

## 6. detached 改变大小位置后应用到 attached 的原理

启动时只设置一次初始位置和尺寸。之后模式切换不再调用 `set_position` 或 `set_size`。

attached 和 detached 的 Win32 层切换都使用 `SWP_NOMOVE | SWP_NOSIZE`，因此当前 HWND 的矩形会在切换父窗口/层级时保留。用户在 detached 下调整位置和大小后，再切回 attached，会继续使用当前窗口矩形。

## 7. Attached Mode Desktop Layer Guard

守护线程在 `src-tauri/src/lib.rs` 中启动：

- 仅 attached 标志为 true 时工作。
- 每秒检查一次 `is_attached_to_desktop_icon_layer`。
- 检查内容包括：
  - 当前 HWND 是否仍 parent 到有效 WorkerW。
  - 当前 HWND 是否 `IsWindowVisible`。
- 如果失效，自动调用 `attach_to_desktop_icon_layer(&window)`，再调用 `window.show()`。
- detached 模式下守护线程休眠，不干扰普通窗口层级。

该守护线程解决的是 Explorer 刷新、壁纸变化、显示器变化、开发热更新或 Explorer 重启后，进程仍存在但挂件视觉消失的问题。

## 8. Manual Close Only

Manual Close Only 在 `src-tauri/src/lib.rs` 和 `src-tauri/src/app_state.rs` 中实现：

- 默认 `allow_exit = false`。
- Tauri run loop 拦截 `RunEvent::ExitRequested`。
- 如果 `allow_exit` 为 false，调用 `api.prevent_exit()`。
- 前端 Close 按钮调用 `close_app`。
- `close_app` 设置 `allow_exit = true`，然后调用 `app.exit(0)`。

它解决的是“真实退出请求导致 Tauri 事件循环结束”的问题，不是 WorkerW 失效导致的视觉消失问题。WorkerW 失效由 Desktop Layer Guard 处理。

## 9. attached/detached 的 Win32 样式说明

- `WS_CHILD`：attached 模式需要的子窗口样式，使 HWND 可以稳定作为 WorkerW 的子窗口存在。
- `WS_POPUP`：detached 模式需要的顶层窗口样式，使窗口恢复普通应用窗口行为。
- `ShowWindow(hwnd, SW_SHOW)`：在挂载或恢复后显式显示 HWND。
- `SWP_SHOWWINDOW`：`SetWindowPos` 时同步确保窗口显示。
- `SWP_FRAMECHANGED`：样式从 `WS_CHILD`/`WS_POPUP` 切换后通知 Windows 重新应用 frame/style。

## 10. Tauri 权限

`src-tauri/capabilities/default.json` 授权：

- `core:window:allow-start-dragging`
- `core:window:allow-start-resize-dragging`
- `core:window:allow-set-resizable`
- `core:window:allow-set-skip-taskbar`

这些权限保证 detached 下移动、缩放、模式切换和任务栏显示状态切换可用。

## 11. 当前已知约束和后续生产化注意事项

- WorkerW / Progman / SHELLDLL_DefView 是 Windows Explorer 的非正式层级方案，Windows 优先，不作为跨平台能力承诺。
- attached 模式的窗口本来就在桌面图标之下，图标可能视觉遮挡挂件。
- attached 模式不能依赖普通 DOM 鼠标事件，关键控件需要保留转发坐标命中逻辑。
- 当前数据为前端 mock，后续接 SQLite 时应把 Schedule、SkinTheme、WidgetSettings、WindowModeState 持久化。
- 后续应增加窗口矩形持久化、皮肤配置持久化、多显示器 DPI 变化处理和 Explorer 重启专项测试。
- 后续移动端同步建议通过后端 API 做增量同步，不让客户端直连云数据库。

# 建议采用 本地 SQLite + 云端 PostgreSQL 的组合。

推荐方案：

开发阶段和客户端本地缓存使用 SQLite。桌面端 Tauri 与后续移动端都可以把课程表、配置、皮肤选择、窗口模式等数据保存到本地 SQLite，支持离线使用。

正式同步阶段使用云端 PostgreSQL 作为权威数据源。桌面端和移动端都不应直接连接云数据库，而是通过后端 HTTP/HTTPS API 同步数据。

推荐架构：

桌面端 Tauri + SQLite
HTTP/HTTPS API
后端服务
云端 PostgreSQL

移动端 + SQLite
HTTP/HTTPS API
后端服务
云端 PostgreSQL

建议主要数据表预留字段：

- `id`
- `user_id`
- `created_at`
- `updated_at`
- `deleted_at`
- `version`
- `device_id`
- `sync_status`

这样后续可以支持离线修改、多设备同步、软删除、冲突处理和增量同步。
