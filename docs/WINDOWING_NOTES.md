# Windowing Notes

`teacher-schedule-widget` 当前提供两种窗口模式：

- attached：挂载到 Windows WorkerW，显示在壁纸上、桌面图标下。
- detached：普通无边框桌面窗口，用于布局编辑、移动和缩放。

核心代码：

- `src-tauri/src/desktop_layer.rs`：WorkerW 查找、SetParent、样式切换。
- `src-tauri/src/window_mode.rs`：attached/detached 命令和窗口状态切换。
- `src-tauri/src/input_forwarder.rs`：attached 模式鼠标转发。
- `src-tauri/src/lib.rs`：启动初始化、桌面层守护线程、Manual Close Only。

前端入口：

- `src/app/App.tsx`：模式状态、Tauri command 调用、转发坐标命中。
- `src/components/ScheduleWidget/ScheduleWidget.tsx`：课程表挂件、拖拽热区、缩放热区。
