# Product Architecture

## 目标

教师课程表挂件是 Windows 优先的 Tauri 桌面程序。第一阶段提供桌面课程表挂件、attached/detached 模式和本地 mock 数据。后续扩展 SQLite、本地配置、皮肤系统、壁纸设置和移动端同步。

## 前端结构

- `src/app`：应用组合层，连接 Tauri、窗口模式、课程表和设置。
- `src/components/ScheduleWidget`：课程表主体组件。
- `src/components/WindowControls`：窗口模式切换和关闭。
- `src/components/SkinPicker`：皮肤选择入口。
- `src/components/SettingsPanel`：挂件设置入口。
- `src/features/schedule`：Weekday、Period、CourseCell、Schedule 数据模型和 mock。
- `src/features/skins`：SkinTheme 和 CSS token 数据。
- `src/features/windowMode`：WindowModeState 和 desktop-input 类型。
- `src/features/settings`：WidgetSettings 数据模型。
- `src/styles/themes`：皮肤 token 默认值。

## 后端/Rust 结构

- `src-tauri/src/app_state.rs`：attached 标志和 allow_exit 状态。
- `src-tauri/src/config_store.rs`：配置读取占位，后续接 SQLite。
- `src-tauri/src/desktop_layer.rs`：Windows WorkerW 桌面层。
- `src-tauri/src/input_forwarder.rs`：attached 模式输入转发。
- `src-tauri/src/window_mode.rs`：窗口模式命令。
- `src-tauri/src/lib.rs`：Tauri 启动、守护线程和退出控制。

## 后续扩展方向

- SQLite：持久化课程表、窗口矩形、皮肤和设置。
- 同步：通过后端 API 与云端 PostgreSQL 同步。
- 皮肤：扩展 SkinTheme token，避免 UI 颜色散落硬编码。
- 壁纸设置：后续可增加背景透明度、挂件锁定、位置预设。
- 多端：保持 Schedule 和 WidgetSettings 模型适合移动端复用。
