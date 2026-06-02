import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SettingsWindow } from "../components/SettingsWindow/SettingsWindow";
import {
  defaultAppearanceSettings,
  type SettingsSection,
  type WidgetSettingsState,
} from "../features/settings/settingsTypes";
import type { WindowMode } from "../features/windowMode/types";
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
  periodCount: 8,
  term: {
    startDate: "2026-03-05",
    endDate: "2026-06-30",
  },
  appearance: defaultAppearanceSettings,
};

export function SettingsWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [settings, setSettings] = useState<WidgetSettingsState>(defaultSettings);
  const [activeSection, setActiveSection] = useState<SettingsSection>("schedule");
  const [windowMode, setWindowMode] = useState<WindowMode>("attached");
  const settingsRef = useRef(settings);
  const activeSectionRef = useRef(activeSection);
  const computedWeek = useMemo(() => calculateWeekNumber(settings.term.startDate, getBeijingToday()), [settings.term.startDate]);

  const closeWindow = useCallback(async () => {
    await emitTo(WIDGET_WINDOW_LABEL, SETTINGS_WINDOW_CLOSE_EVENT, {
      windowLabel: currentWindow.label,
    });
    await currentWindow.hide();
  }, [currentWindow]);

  useEffect(() => {
    const unlistenState = listen<SettingsWindowStatePayload>(SETTINGS_WINDOW_STATE_EVENT, (event) => {
      const activeSection = normalizeSettingsSection(event.payload.activeSection);
      settingsRef.current = event.payload.settings;
      activeSectionRef.current = activeSection;
      setWindowMode(event.payload.windowMode ?? "attached");
      setSettings(event.payload.settings);
      setActiveSection(activeSection);
    });

    void emitTo(WIDGET_WINDOW_LABEL, SETTINGS_WINDOW_STATE_REQUEST_EVENT, {
      windowLabel: currentWindow.label,
    });

    return () => {
      void unlistenState.then((unlisten) => unlisten());
    };
  }, [currentWindow.label]);

  useEffect(() => {
    const unlistenPromise = currentWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await closeWindow();
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [closeWindow, currentWindow]);

  const emitUpdate = (nextSettings: WidgetSettingsState, nextSection = activeSection) => {
    settingsRef.current = nextSettings;
    activeSectionRef.current = nextSection;
    setSettings(nextSettings);
    setActiveSection(nextSection);
    void emitTo<SettingsWindowUpdatePayload>(WIDGET_WINDOW_LABEL, SETTINGS_WINDOW_UPDATE_EVENT, {
      windowLabel: currentWindow.label,
      settings: nextSettings,
      activeSection: nextSection,
      windowMode,
    });
  };

  return (
    <main className="dialog-window-root">
      <SettingsWindow
        open
        activeSection={activeSection}
        settings={settings}
        computedWeek={computedWeek}
        windowMode={windowMode}
        onActiveSectionChange={(section) => emitUpdate(settings, section)}
        onSettingsChange={(nextSettings) => emitUpdate(nextSettings)}
      />
    </main>
  );
}

function calculateWeekNumber(startDate: string, currentDate: Date): number {
  const start = parseIsoDateOnly(startDate);
  if (Number.isNaN(start.getTime())) {
    return 1;
  }

  const currentDayOnly = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  const startDay = start.getTime();
  const currentDay = currentDayOnly.getTime();
  const diffDays = Math.floor((currentDay - startDay) / 86400000);
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

function getBeijingToday(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    const fallback = new Date();
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }

  return new Date(year, month - 1, day);
}

function parseIsoDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return new Date(Number.NaN);
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function normalizeSettingsSection(section: SettingsSection | string): SettingsSection {
  return section === "term" || section === "appearance" ? section : "schedule";
}
