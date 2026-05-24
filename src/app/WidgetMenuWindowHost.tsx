import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState } from "react";
import {
  WIDGET_MENU_ACTION_EVENT,
  WIDGET_MENU_STATE_EVENT,
  WIDGET_WINDOW_LABEL,
  type WidgetMenuAction,
  type WidgetMenuStatePayload,
} from "../features/settings/windowEvents";
import type { WindowMode, WindowModeState } from "../features/windowMode/types";

export function WidgetMenuWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [mode, setMode] = useState<WindowMode>("attached");

  useEffect(() => {
    void invoke<WindowModeState>("get_window_mode").then((state) => {
      setMode(state.mode);
    });

    const unlistenWindowState = listen<WidgetMenuStatePayload>(WIDGET_MENU_STATE_EVENT, (event) => {
      setMode(event.payload.mode);
    });

    return () => {
      void unlistenWindowState.then((unlisten) => unlisten());
    };
  }, []);

  const runAction = async (action: WidgetMenuAction) => {
    await invoke("clear_proxy_menu_open");
    await emitTo(WIDGET_WINDOW_LABEL, WIDGET_MENU_ACTION_EVENT, action);
    await currentWindow.hide();
  };

  return (
    <main className="widget-menu-window-root">
      <button type="button" className="menu-item" onClick={() => runAction("settings")}>
        <span className="menu-icon" aria-hidden="true">
          ⚙
        </span>
        <span>设置</span>
      </button>
      <button type="button" className="menu-item" onClick={() => runAction("mode")}>
        <span className="menu-icon" aria-hidden="true">
          {mode === "attached" ? "⟐" : "◫"}
        </span>
        <span>{mode === "attached" ? "浮起" : "贴靠"}</span>
      </button>
      <button type="button" className="menu-item menu-close-item" onClick={() => runAction("hide")}>
        <span className="menu-icon menu-close-icon" aria-hidden="true">
          ×
        </span>
        <span>关闭</span>
      </button>
    </main>
  );
}
