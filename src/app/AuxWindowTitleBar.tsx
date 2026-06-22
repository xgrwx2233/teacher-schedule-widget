import { getCurrentWindow } from "@tauri-apps/api/window";

type AuxWindowTitleBarProps = {
  title: string;
  maximize?: boolean;
  closeMode?: "hide" | "close";
};

export function AuxWindowTitleBar({
  title,
  maximize = true,
  closeMode = "hide",
}: AuxWindowTitleBarProps) {
  const runWindowAction = (action: "minimize" | "toggleMaximize" | "close") => {
    const currentWindow = getCurrentWindow();
    if (action === "minimize") {
      void currentWindow.minimize();
      return;
    }
    if (action === "toggleMaximize") {
      void currentWindow.toggleMaximize();
      return;
    }
    if (closeMode === "hide") {
      void currentWindow.hide();
      return;
    }
    void currentWindow.close();
  };

  return (
    <header className="aux-window-titlebar">
      <h1 data-tauri-drag-region>{title}</h1>
      <div className="aux-window-controls">
        <button type="button" title="最小化" onClick={() => runWindowAction("minimize")}>
          -
        </button>
        {maximize ? (
          <button
            type="button"
            title="最大化"
            onClick={() => runWindowAction("toggleMaximize")}
          >
            □
          </button>
        ) : null}
        <button
          type="button"
          title="关闭"
          className="close"
          onClick={() => runWindowAction("close")}
        >
          ×
        </button>
      </div>
    </header>
  );
}
