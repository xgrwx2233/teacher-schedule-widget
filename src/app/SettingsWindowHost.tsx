import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SettingsWindow } from "../components/SettingsWindow/SettingsWindow";
import {
  defaultAppearanceSettings,
  type PeriodConfigItem,
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

const defaultPeriods: PeriodConfigItem[] = [];

export function SettingsWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [settings, setSettings] =
    useState<WidgetSettingsState>(defaultSettings);
  const [periods, setPeriods] = useState<PeriodConfigItem[]>(defaultPeriods);
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("schedule");
  const [windowMode, setWindowMode] = useState<WindowMode>("attached");
  const settingsRef = useRef(settings);
  const periodsRef = useRef(periods);
  const activeSectionRef = useRef(activeSection);
  const computedWeek = useMemo(
    () =>
      getTermWeekInfo(
        settings.term.startDate,
        settings.term.endDate,
        getBeijingToday(),
      ).baseWeek,
    [settings.term.endDate, settings.term.startDate],
  );

  const closeWindow = useCallback(async () => {
    await emitTo(WIDGET_WINDOW_LABEL, SETTINGS_WINDOW_CLOSE_EVENT, {
      windowLabel: currentWindow.label,
    });
    await currentWindow.hide();
  }, [currentWindow]);

  useEffect(() => {
    const unlistenState = listen<SettingsWindowStatePayload>(
      SETTINGS_WINDOW_STATE_EVENT,
      (event) => {
        const activeSection = normalizeSettingsSection(
          event.payload.activeSection,
        );
        settingsRef.current = event.payload.settings;
        periodsRef.current = event.payload.periods ?? [];
        activeSectionRef.current = activeSection;
        setWindowMode(event.payload.windowMode ?? "attached");
        setSettings(event.payload.settings);
        setPeriods(event.payload.periods ?? []);
        setActiveSection(activeSection);
      },
    );

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

  const emitUpdate = (
    nextSettings: WidgetSettingsState,
    nextSection = activeSection,
    nextPeriods = periodsRef.current,
  ) => {
    settingsRef.current = nextSettings;
    periodsRef.current = nextPeriods;
    activeSectionRef.current = nextSection;
    setSettings(nextSettings);
    setPeriods(nextPeriods);
    setActiveSection(nextSection);
    void emitTo<SettingsWindowUpdatePayload>(
      WIDGET_WINDOW_LABEL,
      SETTINGS_WINDOW_UPDATE_EVENT,
      {
        windowLabel: currentWindow.label,
        settings: nextSettings,
        activeSection: nextSection,
        periods: nextPeriods,
        windowMode,
      },
    );
  };

  return (
    <main className="dialog-window-root">
      <SettingsWindow
        open
        activeSection={activeSection}
        settings={settings}
        periods={periods}
        computedWeek={computedWeek}
        windowMode={windowMode}
        onActiveSectionChange={(section) => emitUpdate(settings, section)}
        onSettingsChange={(nextSettings) => emitUpdate(nextSettings)}
        onPeriodsChange={(nextPeriods) =>
          emitUpdate(settingsRef.current, activeSectionRef.current, nextPeriods)
        }
      />
    </main>
  );
}

function getTermWeekInfo(
  startDate: string,
  endDate: string,
  currentDate: Date,
): { baseWeek: number; totalWeeks: number } {
  const start = parseIsoDateOnly(startDate);
  const end = parseIsoDateOnly(endDate);
  const totalWeeks = calculateTermTotalWeeks(start, end);

  if (Number.isNaN(start.getTime())) {
    return { baseWeek: 1, totalWeeks };
  }

  const weekBase = getWeekStartForTerm(start);
  const endOnly = Number.isNaN(end.getTime())
    ? start
    : new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const currentDayOnly = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate(),
  );

  if (currentDayOnly.getTime() < weekBase.getTime()) {
    return { baseWeek: 1, totalWeeks };
  }

  if (currentDayOnly.getTime() > endOnly.getTime()) {
    return { baseWeek: totalWeeks, totalWeeks };
  }

  const diffDays = Math.floor(
    (currentDayOnly.getTime() - weekBase.getTime()) / 86400000,
  );
  return {
    baseWeek: clampWeek(Math.floor(diffDays / 7) + 1, totalWeeks),
    totalWeeks,
  };
}

function calculateTermTotalWeeks(start: Date, end: Date): number {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 1;
  }

  const weekBase = getWeekStartForTerm(start);
  const endOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const diffDays = Math.floor(
    (endOnly.getTime() - weekBase.getTime()) / 86400000,
  );
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

function getWeekStartForTerm(start: Date): Date {
  const normalized = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  const mondayBasedDay = (normalized.getDay() + 6) % 7;
  normalized.setDate(normalized.getDate() - mondayBasedDay);
  return normalized;
}

function clampWeek(week: number, totalWeeks: number): number {
  return Math.max(1, Math.min(Math.max(1, totalWeeks), week));
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

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    const fallback = new Date();
    return new Date(
      fallback.getFullYear(),
      fallback.getMonth(),
      fallback.getDate(),
    );
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

function normalizeSettingsSection(
  section: SettingsSection | string,
): SettingsSection {
  return section === "periods" || section === "term" || section === "appearance"
    ? section
    : "schedule";
}
