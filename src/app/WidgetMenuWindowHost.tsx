import { emitTo } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useMemo } from "react";
import {
  WIDGET_MENU_ACTION_EVENT,
  WIDGET_WINDOW_LABEL,
  type WidgetMenuAction,
} from "../features/settings/windowEvents";

export function WidgetMenuWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);

  const runAction = async (action: WidgetMenuAction) => {
    await invoke("clear_proxy_menu_open");
    await emitTo(WIDGET_WINDOW_LABEL, WIDGET_MENU_ACTION_EVENT, action);
    await currentWindow.hide();
  };

  return (
    <main className="widget-menu-window-root">
      <button type="button" className="menu-item" onClick={() => runAction("settings")}>
        设置
      </button>
      <button type="button" className="menu-item" onClick={() => runAction("mode")}>
        浮/贴
      </button>
      <button type="button" className="menu-item menu-close-item" onClick={() => runAction("close")}>
        X
      </button>
    </main>
  );
}
