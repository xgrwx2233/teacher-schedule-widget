# Win10 版本开发隔离指南

本文档用于指导后续在 Windows 10 电脑上的 Codex 继续开发 `teacher-schedule-widget` 的 Win10 版本。目标是隔离 Win10 桌面附着层问题，避免调 Win10 时破坏 Win11 已稳定功能、同步功能、UI/UX 和课程表业务逻辑。

## 项目目标

这是一个 Windows 桌面课程表小挂件，使用 Tauri v2 + React + TypeScript + Rust 实现。

核心能力：

- 小挂件默认以 `attached` 模式运行，贴到桌面图标层下、壁纸层上。
- `detached` 模式是普通桌面窗口，用于移动、缩放和普通窗口交互。
- `attached` 模式的小挂件鼠标交互通过交互代理窗口处理。
- `detached` 模式和所有设置/登录/菜单/卡片设置窗口必须按普通桌面窗口逻辑交互。
- 支持课程卡片、课次卡片、临时改课、合并/拆分、毛玻璃背景、本地账号和本地同步。

## 当前 Win10/Win11 分离方式

代码已经使用 Cargo feature 分离 Win10 和 Win11 桌面附着实现：

- `desktop-win10`: 编译 Win10 桌面层。
- `desktop-win11`: 编译 Win11 桌面层。
- 两个 feature 互斥，不能同时启用。

入口文件：

- `src-tauri/src/desktop_layer/mod.rs`

当前导出规则：

```rust
#[cfg(feature = "desktop-win10")]
mod win10;
#[cfg(not(feature = "desktop-win10"))]
mod win11;

#[cfg(feature = "desktop-win10")]
pub use win10::*;
#[cfg(not(feature = "desktop-win10"))]
pub use win11::*;
```

开发命令：

```powershell
npm install
npm run tauri:dev:win10
npm run tauri:dev:win11
npm run check:rust:win10
npm run check:rust:win11
npm exec tsc -- --noEmit
npm run build
```

构建命令：

```powershell
npm run tauri:build:win10
npm run tauri:build:win11
```

## 最高交互规则

必须保持这条规则不变：

1. `attached` 模式下，小挂件鼠标交互单独设计，通过 `interaction-proxy` 代理处理。
2. `detached` 模式下，小挂件是普通桌面窗口，使用正常 DOM/窗口事件。
3. 设置窗口、登录窗口、菜单窗口、课程卡片设置窗口、课次卡片设置窗口、极简工具栏窗口全部是普通窗口，不应被附着层或代理窗口拦截。
4. 修复 Win10 `attached` 时，不能把普通窗口逻辑改成代理逻辑。
5. 修复 Win10 残影、黑块、标题栏残影时，不能影响 Win11 的 `attached` 行为。

## 不允许改动的区域

除非用户明确要求，不要改以下区域。

### 同步和账号

禁止改：

- `src-tauri/src/local_account.rs`
- 前端同步状态模型和按钮状态
- 本地账号注册/登录/退出逻辑
- 本地数据同步策略、冲突策略、数据保存结构
- WebSocket/轮询/手动同步流程

原因：同步功能已经是独立业务层，和 Win10 桌面附着问题无关。Win10 attach 修复不应改变用户数据。

### 课程表业务数据

禁止改：

- 课程表默认数据结构
- 课程卡片字段含义
- 课次卡片字段含义
- 临时改课数据结构
- 合并/拆分规则
- 排课日期规则
- 保存/加载格式

典型文件：

- `src/features/settings/settingsTypes.ts`
- `src/features/schedule/*`
- `src/app/App.tsx` 中课程表状态、合并拆分、临时改课、保存同步相关逻辑

除非修复明确是交互入口问题，否则不要碰业务计算函数。

### UI/UX 视觉设计

禁止为了 Win10 attach 修复而改：

- 课程表外观
- 设置窗口布局
- 登录窗口布局
- 临时改动 tab 布局
- 课程卡片/课次卡片样式
- 毛玻璃前端 UI 控件
- 菜单图标和工具栏图标
- 默认尺寸以外的布局规则

典型文件：

- `src/styles/base.css`
- `src/styles/themes/*`
- `src/components/*`

例外：如果 Win10 修复必须增加一个不可见调试标识或 data attribute，需保持视觉不变，并在提交说明中明确。

### Win11 桌面层

禁止在 Win10 修复中改：

- `src-tauri/src/desktop_layer/win11.rs`

除非用户明确要求修复 Win11，或者 Win10/Win11 的公共接口确实需要一起调整。Win11 已经可以正常 attached，不要用 Win10 方案覆盖 Win11 方案。

### 发布配置

禁止随意改：

- `src-tauri/tauri.conf.json`
- `src-tauri/tauri.win11.conf.json`
- release profile
- asset protocol scope
- devtools/sourcemap/minify 配置
- bundle/install 配置

例外：如果需要单独增加 Win10 包名、图标、安装名，必须只改 Win10 config，并说明不会影响 Win11 包。

## 允许优先改动的区域

Win10 attach 问题优先只在以下区域处理。

### Win10 桌面附着层

允许改：

- `src-tauri/src/desktop_layer/win10.rs`

这是 Win10 版本的主要可改区域。可以修改：

- WorkerW/Progman 查找
- SetParent 策略
- 样式位清理
- 非客户区标题栏残影处理
- Win10 退出清理
- Win10 hide/show 残影清理
- Win10 attached/detached 切换时的窗口样式恢复
- Win10 桌面刷新策略

要求：

- 保持导出的函数签名和 `win11.rs` 兼容。
- 不要把失败 attach 自动切到 detached。
- `attached` 失败时可以返回 diagnostics，但状态仍应表达为用户选择的 attached。

### Win10/Win11 公共窗口模式入口

谨慎允许改：

- `src-tauri/src/window_mode.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/app_state.rs`
- `src-tauri/src/widget_manager.rs`

仅当 Win10 attach 需要公共状态协调时才改。常见允许改动：

- 增加 diagnostics 字段
- 调整 attached/detached 切换顺序
- 在切换前后调用 Win10 专用清理函数，但通过 `desktop_layer::*` 抽象调用
- 修复窗口显示/隐藏顺序导致的代理错位

禁止在这些文件里写 Windows 10 专用 Win32 细节。Win32 细节必须下沉到 `desktop_layer/win10.rs`。

### 交互代理

谨慎允许改：

- `src-tauri/src/interaction_proxy.rs`
- `src/app/InteractionProxyHost.tsx`
- `src/features/windowMode/*`

只允许修复 attached 模式代理层的鼠标命中、穿透和释放问题。

不能改：

- detached 模式的普通 DOM 交互
- 其他普通窗口的交互方式
- 卡片双击/按钮点击的业务含义

### 输入转发

谨慎允许改：

- `src-tauri/src/input_forwarder.rs`

只允许处理 attached 模式下小挂件接收鼠标移动、点击、离开等基础输入的转发问题。

不能让它影响 detached 模式或普通辅助窗口。

### 辅助窗口生命周期

谨慎允许改：

- `src-tauri/src/settings_windows.rs`
- `src/app/CardSettingsWindowHost.tsx`
- `src/app/SettingsWindowHost.tsx`
- `src/app/AuthWindowHost.tsx`
- `src/app/WidgetMenuWindowHost.tsx`
- `src/app/FloatingToolbarWindowHost.tsx`

只允许修复窗口打开/隐藏/关闭状态、权限、路由和代理释放问题。

不能改 UI 内容和业务字段。

## 推荐代码结构调整

当前已经有 `desktop_layer/win10.rs` 与 `desktop_layer/win11.rs`，暂时不需要大重构。

如果 Win10 继续复杂化，推荐只在 `src-tauri/src/desktop_layer/` 下增加 Win10 内部子模块，例如：

```text
src-tauri/src/desktop_layer/
  mod.rs
  win10.rs
  win10/
    host.rs
    frame_cleanup.rs
    wallpaper_refresh.rs
    diagnostics.rs
  win11.rs
```

约束：

- 外部仍只通过 `desktop_layer::*` 调用。
- 不改变 `window_mode.rs` 对桌面层的抽象接口，除非确实需要新增公共函数。
- Win10 子模块只能被 `win10.rs` 使用，不要从通用层直接引用。

## Win10 开发推荐流程

1. 从 GitHub 拉取最新 `master`。
2. 先运行：

```powershell
npm install
npm exec tsc -- --noEmit
npm run check:rust:win10
npm run check:rust:win11
```

3. 在 Win10 上运行：

```powershell
npm run tauri:dev:win10
```

4. 只修改 Win10 允许区域。
5. 每次修复后至少验证：

```powershell
npm exec tsc -- --noEmit
npm run check:rust:win10
npm run check:rust:win11
npm run build
```

6. 如果改了 Rust 桌面层，必须在 Win10 实机验证：

- 启动默认 attached。
- attached 时小挂件在桌面图标层下、壁纸层上。
- attached 时没有标题栏残影。
- attached 时隐藏/显示课程表没有黑色残影。
- attached 切 detached 后，窗口可点击、可拖动、可缩放。
- detached 切 attached 后，恢复贴靠。
- 退出程序后桌面无残影。
- 小挂件按钮、课程单元格、课次单元格、菜单、登录窗口、设置窗口都能打开和关闭。

7. 如果有条件，在 Win11 上只做回归验证：

```powershell
npm run tauri:dev:win11
```

重点确认 Win11 attached 仍然正常。

## Win10 实机测试清单

### attached 模式

- 启动后自动 attached。
- 小挂件无系统标题栏。
- 小挂件无黑底、白边、蓝色标题栏残影。
- 桌面图标可正常点击，不被小挂件无关区域阻挡。
- 小挂件课程单元格/课次单元格交互正常。
- 工具栏按钮正常。
- 极简模式左上角工具栏按钮正常。
- 托盘右键菜单能显示/关闭课程表。
- 隐藏/显示后无残影。
- 切换壁纸后毛玻璃仍能刷新。

### detached 模式

- 小挂件是普通桌面窗口。
- 鼠标离开或点击外部不会出现标题栏白条。
- 右下角缩放热区显示正确鼠标样式。
- 课程单元格/课次单元格双击打开设置窗口稳定。
- 所有普通窗口关闭按钮可单击关闭。
- 不需要双击才能关闭普通窗口。

### 辅助窗口

- 设置窗口可打开、可关闭。
- 登录窗口可打开、可关闭、可再次打开。
- 课程卡片设置窗口可打开、可关闭、可再次打开。
- 课次卡片设置窗口可打开、内容非空、可关闭、可再次打开。
- 菜单窗口不会阻塞后续点击。

## 必须避免的修复方式

不要使用这些方式：

- attach 失败就自动切到 detached。
- 为了 Win10，把 Win11 的 attach 实现一起改掉。
- 用全局 always-on-top 解决点击问题。
- 让代理窗口覆盖普通设置/登录窗口。
- 用前端 CSS 修改普通窗口行为来掩盖 Win32 残影。
- 修改课程数据或同步数据来验证窗口问题。
- 删除毛玻璃刷新、壁纸监听、签名兜底等已有功能。
- 修改 UI 布局来规避点击或残影问题。

## 提交规则

每次 Win10 修复建议一个小提交：

- 提交名说明具体问题，例如 `Fix Win10 attached titlebar ghost`。
- 提交里不要混入格式化无关文件。
- 如果只改 Win10，应只看到 `win10.rs` 或 Win10 专用模块变化。
- 修复后推送 GitHub，方便另一台机器拉取测试。

推荐提交前检查：

```powershell
git status --short
git diff --name-only
npm exec tsc -- --noEmit
npm run check:rust:win10
npm run check:rust:win11
npm run build
```

## 给 Win10 Codex 的启动提示词

可以在 Win10 新会话中使用以下提示：

```text
请先阅读 docs/WIN10_DEVELOPMENT_GUIDE.md。
当前任务只开发 Windows 10 版本的 attached/detached 兼容问题。
最高规则：
1. attached 模式的小挂件鼠标交互通过 interaction proxy 单独处理。
2. detached 模式和所有设置/登录/菜单/卡片设置窗口都是普通桌面窗口。
3. 不要改同步策略、账号系统、课程表数据模型、UI/UX、课程卡片业务逻辑、Win11 desktop layer。
4. 优先只改 src-tauri/src/desktop_layer/win10.rs；必要时通过 desktop_layer 抽象增加 Win10 专用函数。
5. 不允许 attach 失败自动切 detached，要真正修复 Win10 attached。
6. 每次修改后运行 npm exec tsc -- --noEmit、npm run check:rust:win10、npm run check:rust:win11、npm run build，并提交推送。

请先说明你准备修改的文件和理由，再实施。
```

