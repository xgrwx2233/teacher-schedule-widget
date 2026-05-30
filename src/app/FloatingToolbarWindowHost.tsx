import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState } from "react";
import { ScheduleToolbar } from "../components/ScheduleToolbar/ScheduleToolbar";
import {
  FLOATING_TOOLBAR_ACTION_EVENT,
  FLOATING_TOOLBAR_CLOSE_EVENT,
  FLOATING_TOOLBAR_STATE_EVENT,
  WIDGET_WINDOW_LABEL,
  type FloatingToolbarAction,
  type FloatingToolbarStatePayload,
  type ToolbarLayoutMode,
} from "../features/settings/windowEvents";
import type { WidgetBackgroundMode } from "../features/settings/settingsTypes";

export function FloatingToolbarWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [weekNumber, setWeekNumber] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toolbarLayoutMode, setToolbarLayoutMode] = useState<ToolbarLayoutMode>("minimalist");
  const [backgroundMode, setBackgroundMode] = useState<WidgetBackgroundMode>("blur");

  useEffect(() => {
    const unlistenWindowState = listen<FloatingToolbarStatePayload>(FLOATING_TOOLBAR_STATE_EVENT, (event) => {
      setWeekNumber(event.payload.weekNumber);
      setMenuOpen(event.payload.menuOpen);
      setToolbarLayoutMode(event.payload.toolbarLayoutMode);
      setBackgroundMode(event.payload.backgroundMode);
    });
    const unlistenClose = currentWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await emitTo(WIDGET_WINDOW_LABEL, FLOATING_TOOLBAR_CLOSE_EVENT);
      await currentWindow.hide();
    });

    return () => {
      void unlistenWindowState.then((unlisten) => unlisten());
      void unlistenClose.then((unlisten) => unlisten());
    };
  }, [currentWindow]);

  const runAction = async (action: FloatingToolbarAction) => {
    const payload = { action, windowLabel: "floating-toolbar" } as const;
    if (action !== "menu") {
      await emit(FLOATING_TOOLBAR_ACTION_EVENT, payload);
      return;
    }

    const button = document.querySelector<HTMLButtonElement>("[data-menu-button]");
    if (!button) {
      await emit(FLOATING_TOOLBAR_ACTION_EVENT, payload);
      return;
    }

    const rect = button.getBoundingClientRect();
    const windowPosition = await currentWindow.outerPosition();
    const scaleFactor = window.devicePixelRatio || 1;
    await emit(FLOATING_TOOLBAR_ACTION_EVENT, {
      ...payload,
      anchor: {
        x: windowPosition.x + Math.round(rect.left * scaleFactor),
        y: windowPosition.y + Math.round(rect.top * scaleFactor),
        width: Math.round(rect.width * scaleFactor),
        height: Math.round(rect.height * scaleFactor),
      },
    });
  };

  return (
    <main className={`floating-toolbar-window-root background-${backgroundMode}`} data-window-label="floating-toolbar">
      <ScheduleToolbar
        weekNumber={weekNumber}
        menuOpen={menuOpen}
        toolbarLayoutMode={toolbarLayoutMode}
        backgroundMode={backgroundMode}
        variant="floating"
        onPreviousWeek={() => void runAction("previous-week")}
        onNextWeek={() => void runAction("next-week")}
        onToggleLayoutMode={() => void runAction("layout")}
        onToggleMenu={() => void runAction("menu")}
      />
    </main>
  );
}
