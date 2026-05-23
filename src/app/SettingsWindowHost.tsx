import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PointerEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { SettingsWindow } from "../components/SettingsWindow/SettingsWindow";
import type { SettingsSection, WidgetSettingsState } from "../features/settings/settingsTypes";
import {
  SETTINGS_WINDOW_CLOSE_EVENT,
  SETTINGS_WINDOW_STATE_EVENT,
  SETTINGS_WINDOW_STATE_REQUEST_EVENT,
  SETTINGS_WINDOW_UPDATE_EVENT,
  WIDGET_WINDOW_LABEL,
  type SettingsWindowStatePayload,
  type SettingsWindowUpdatePayload,
} from "../features/settings/windowEvents";

const defaultSettings: WidgetSettingsState = {
  workdayMode: "mon-fri",
  term: {
    startDate: "2026-03-05",
    endDate: "2026-06-30",
  },
};

export function SettingsWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [settings, setSettings] = useState<WidgetSettingsState>(defaultSettings);
  const [activeSection, setActiveSection] = useState<SettingsSection>("workdays");
  const computedWeek = useMemo(() => calculateWeekNumber(settings.term.startDate, new Date()), [settings.term.startDate]);

  useEffect(() => {
    const unlistenState = listen<SettingsWindowStatePayload>(SETTINGS_WINDOW_STATE_EVENT, (event) => {
      setSettings(event.payload.settings);
      setActiveSection(event.payload.activeSection);
    });

    void emitTo(WIDGET_WINDOW_LABEL, SETTINGS_WINDOW_STATE_REQUEST_EVENT, {
      windowLabel: currentWindow.label,
    });

    return () => {
      void unlistenState.then((unlisten) => unlisten());
    };
  }, [currentWindow.label]);

  const emitUpdate = (nextSettings: WidgetSettingsState, nextSection = activeSection) => {
    setSettings(nextSettings);
    setActiveSection(nextSection);
    void emitTo<SettingsWindowUpdatePayload>(WIDGET_WINDOW_LABEL, SETTINGS_WINDOW_UPDATE_EVENT, {
      windowLabel: currentWindow.label,
      settings: nextSettings,
      activeSection: nextSection,
    });
  };

  const startDrag = async (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    await currentWindow.startDragging();
  };

  const closeWindow = async () => {
    await emitTo(WIDGET_WINDOW_LABEL, SETTINGS_WINDOW_CLOSE_EVENT, {
      windowLabel: currentWindow.label,
    });
    await currentWindow.hide();
  };

  return (
    <main className="dialog-window-root">
      <SettingsWindow
        open
        activeSection={activeSection}
        settings={settings}
        computedWeek={computedWeek}
        onActiveSectionChange={(section) => emitUpdate(settings, section)}
        onSettingsChange={(nextSettings) => emitUpdate(nextSettings)}
        onDragStart={startDrag}
        onClose={closeWindow}
      />
    </main>
  );
}

function calculateWeekNumber(startDate: string, currentDate: Date): number {
  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) {
    return 1;
  }

  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const currentDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()).getTime();
  const diffDays = Math.floor((currentDay - startDay) / 86400000);
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}
