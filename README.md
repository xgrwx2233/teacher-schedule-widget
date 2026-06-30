# 教师课程表挂件

Windows 优先的 Tauri v2 + React + TypeScript 桌面课程表挂件。

## 环境要求

- Windows 10/11
- Node.js 20+
- Rust stable
- WebView2 Runtime

## 安装依赖

```powershell
npm install
```

## 开发运行

Windows 11:

```powershell
npm run tauri:dev:win11
```

Windows 10:

```powershell
npm run tauri:dev:win10
```

## 检查

```powershell
npm run build
npm run check:rust:win11
npm run check:rust:win10
```

## 构建安装包

Windows 11:

```powershell
npm run tauri:build:win11
```

Windows 10:

```powershell
npm run tauri:build:win10
```

构建产物会输出到 `src-tauri/target` 下。默认窗口启动为 attached 模式，挂载到 Windows WorkerW 桌面层；detached 模式用于移动、缩放和布局编辑。
