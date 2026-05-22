# 教师课程表挂件

Windows 优先的 Tauri v2 + React + TypeScript 桌面课程表挂件。

## 开发运行

```powershell
npm install
npm run tauri:dev
```

## 构建

```powershell
npm run build
cd src-tauri
cargo check
cd ..
npm run tauri:build
```

默认窗口启动为 attached 模式，挂载到 Windows WorkerW 桌面层。detached 模式用于移动、缩放和布局编辑。
