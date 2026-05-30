import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { CSSProperties, PointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScheduleWidget } from "../components/ScheduleWidget/ScheduleWidget";
import { allScheduleDays, mockSchedule } from "../features/schedule/mockSchedule";
import type {
  CardStyle,
  CourseCell,
  CourseScheduleRule,
  PeriodInfo,
  Schedule,
  ScheduleRow,
  Weekday,
  WorkdayMode,
} from "../features/schedule/types";
import {
  defaultCardDraft,
  defaultAppearanceSettings,
  normalizeAppearanceSettings,
  type CardDraft,
  type CourseCardMergeState,
  type SelectedCard,
  type SettingsSection,
  type WidgetSettingsState,
  toCardStyle,
} from "../features/settings/settingsTypes";
import {
  CARD_SETTINGS_WINDOW_LABEL,
  CARD_SETTINGS_WINDOW_ACTION_EVENT,
  CARD_SETTINGS_WINDOW_CLOSE_EVENT,
  CARD_SETTINGS_WINDOW_STATE_EVENT,
  CARD_SETTINGS_WINDOW_STATE_REQUEST_EVENT,
  CARD_SETTINGS_WINDOW_UPDATE_EVENT,
  SETTINGS_WINDOW_LABEL,
  SETTINGS_WINDOW_CLOSE_EVENT,
  SETTINGS_WINDOW_STATE_EVENT,
  SETTINGS_WINDOW_STATE_REQUEST_EVENT,
  SETTINGS_WINDOW_UPDATE_EVENT,
  WIDGET_MENU_ACTION_EVENT,
  WIDGET_MENU_CLOSE_EVENT,
  WIDGET_MENU_STATE_EVENT,
  WIDGET_MENU_WINDOW_LABEL,
  WIDGET_WINDOW_LABEL,
  FLOATING_TOOLBAR_ACTION_EVENT,
  FLOATING_TOOLBAR_CLOSE_EVENT,
  FLOATING_TOOLBAR_STATE_EVENT,
  FLOATING_TOOLBAR_WINDOW_LABEL,
  type WidgetMenuAction,
  type WidgetMenuStatePayload,
  type FloatingToolbarAction,
  type FloatingToolbarActionPayload,
  type FloatingToolbarStatePayload,
  type CardSettingsWindowStatePayload,
  type CardSettingsWindowActionPayload,
  type CardSettingsWindowUpdatePayload,
  type CardSettingsWindowStateRequestPayload,
  type SettingsWindowStatePayload,
  type SettingsWindowStateRequestPayload,
  type SettingsWindowUpdatePayload,
  type ToolbarLayoutMode,
} from "../features/settings/windowEvents";
import { skinThemes } from "../features/skins/themes";
import { defaultWidgetRegistry } from "../features/widgets/defaultWidgets";
import type { WidgetRegistryState } from "../features/widgets/types";
import {
  INTERACTION_PROXY_LABEL,
  PROXY_HITBOXES_EVENT,
  PROXY_TRIGGER_EVENT,
} from "../features/windowMode/proxyEvents";
import type { DesktopInputEvent, WindowMode, WindowModeState } from "../features/windowMode/types";
import type { ProxyWidgetHit } from "../features/windowMode/types";

declare global {
  interface Window {
    __teacherScheduleProxyTrigger?: (hit: ProxyWidgetHit) => void;
  }
}

const defaultSettings: WidgetSettingsState = {
  workdayMode: "mon-fri",
  periodCount: 8,
  term: {
    startDate: "2026-03-05",
    endDate: "2026-06-30",
  },
  appearance: defaultAppearanceSettings,
};

const DEFAULT_COURSE_ROW_HEIGHT = 66;

export function App() {
  const appWindow = useMemo(() => getCurrentWindow(), []);

  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const scaleFactorRef = useRef(1);
  const menuOpenRef = useRef(false);
  const menuClosedAtRef = useRef(0);
  const toolbarWindowOpenRef = useRef(false);
  const toolbarLayoutModeRef = useRef<ToolbarLayoutMode>("normal");
  const modeRef = useRef<WindowMode>("attached");
  const lastForwardedCardClickRef = useRef<{ key: string; time: number } | null>(null);

  const [mode, setMode] = useState<WindowMode>("attached");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toolbarLayoutMode, setToolbarLayoutMode] = useState<ToolbarLayoutMode>("normal");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("schedule");
  const [settings, setSettings] = useState<WidgetSettingsState>(defaultSettings);
  const [schedule, setSchedule] = useState<Schedule>(mockSchedule);
  const [hovered, setHovered] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null);
  const [cardDraft, setCardDraft] = useState<CardDraft>(defaultCardDraft);
  const [activeSkinId, setActiveSkinId] = useState("midnight-coral");
  const [widgetRegistry, setWidgetRegistry] = useState(defaultWidgetRegistry);
  const settingsWindowOpenRef = useRef(false);
  const cardSettingsWindowOpenRef = useRef(false);
  const settingsRef = useRef(settings);
  const scheduleRef = useRef(schedule);
  const courseRowHeightRef = useRef<number | null>(null);
  const settingsSectionRef = useRef(settingsSection);
  const selectedCardRef = useRef<SelectedCard | null>(selectedCard);
  const cardDraftRef = useRef(cardDraft);

  const activeWidget = widgetRegistry.widgets.find((widget) => widget.id === widgetRegistry.activeWidgetId);
  const activeSkin = skinThemes.find((theme) => theme.id === activeSkinId) ?? skinThemes[0];
  const computedWeek = useMemo(
    () => Math.max(1, calculateWeekNumber(settings.term.startDate, new Date()) + weekOffset),
    [settings.term.startDate, weekOffset],
  );

  const visibleSchedule = useMemo(
    () => ({
      ...schedule,
      weekNumber: computedWeek,
      days: getVisibleDays(settings.workdayMode),
      rows: limitScheduleRows(schedule.rows, settings.periodCount),
    }),
    [computedWeek, schedule, settings.periodCount, settings.workdayMode],
  );
  const normalizedAppearance = useMemo(() => normalizeAppearanceSettings(settings.appearance), [settings.appearance]);
  const widgetStyle = useMemo(() => buildWidgetStyle(settings.appearance, visibleSchedule), [settings.appearance, visibleSchedule]);

  useEffect(() => {
    void invoke<WindowModeState>("get_window_mode").then((state) => setMode(state.mode));
    void invoke<{ activeSkinId: string }>("load_widget_settings").then((loadedSettings) => {
      setActiveSkinId(loadedSettings.activeSkinId);
    });
    void invoke<WidgetRegistryState>("load_widget_registry").then((registry) => {
      setWidgetRegistry(registry);
      const widget = registry.widgets.find((item) => item.id === registry.activeWidgetId);
      if (widget) {
        modeRef.current = widget.mode;
        setMode(widget.mode);
        setActiveSkinId(widget.skinId);
      }
    });

    void appWindow.scaleFactor().then((factor) => {
      scaleFactorRef.current = factor || 1;
    });
  }, [appWindow]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    toolbarLayoutModeRef.current = toolbarLayoutMode;
  }, [toolbarLayoutMode]);

  useEffect(() => {
    menuOpenRef.current = menuOpen;
  }, [menuOpen]);

  useEffect(() => {
    settingsSectionRef.current = settingsSection;
  }, [settingsSection]);

  useEffect(() => {
    selectedCardRef.current = selectedCard;
  }, [selectedCard]);

  useEffect(() => {
    cardDraftRef.current = cardDraft;
  }, [cardDraft]);

  const switchMode = useCallback(async () => {
    const command = modeRef.current === "attached" ? "switch_to_detached" : "switch_to_attached";
    const state = await invoke<WindowModeState>(command);
    modeRef.current = state.mode;
    menuOpenRef.current = false;
    setMode(state.mode);
    setWidgetRegistry((current) => updateActiveWidgetMode(current, state.mode));
    setMenuOpen(false);
    setHovered(false);
    await emitWidgetMenuState(state.mode);
  }, []);

  const hideScheduleWidget = useCallback(async () => {
    menuOpenRef.current = false;
    setMenuOpen(false);
    await invoke("hide_schedule_widget");
  }, []);

  const syncFloatingToolbarState = useCallback(async () => {
    if (!toolbarWindowOpenRef.current) {
      return;
    }

    await emitTo<FloatingToolbarStatePayload>(FLOATING_TOOLBAR_WINDOW_LABEL, FLOATING_TOOLBAR_STATE_EVENT, {
      weekNumber: computedWeek,
      menuOpen: menuOpenRef.current,
      toolbarLayoutMode: toolbarLayoutModeRef.current,
      backgroundMode: normalizedAppearance.backgroundMode,
    });
  }, [computedWeek, normalizedAppearance.backgroundMode]);

  const openFloatingToolbarWindow = useCallback(async () => {
    if (toolbarWindowOpenRef.current) {
      await hideWindowByLabel(FLOATING_TOOLBAR_WINDOW_LABEL);
      toolbarWindowOpenRef.current = false;
      return;
    }

    await invoke("open_floating_toolbar_window");
    toolbarWindowOpenRef.current = true;
    await positionFloatingToolbarWindow();
    await syncFloatingToolbarState();
  }, [syncFloatingToolbarState]);

  const openSettings = useCallback(async () => {
    menuOpenRef.current = false;
    setMenuOpen(false);
    const currentSettings = settingsRef.current;
    const currentSection = settingsSectionRef.current;

    try {
      await invoke("open_settings_window");
      settingsWindowOpenRef.current = true;
      await emitTo<SettingsWindowStatePayload>(SETTINGS_WINDOW_LABEL, SETTINGS_WINDOW_STATE_EVENT, {
        settings: currentSettings,
        activeSection: currentSection,
      });
    } catch (error) {
      console.error("failed to open settings window", error);
    }
  }, []);

  const closeWidgetMenu = useCallback(async () => {
    menuClosedAtRef.current = Date.now();
    menuOpenRef.current = false;
    setMenuOpen(false);
    await invoke("clear_proxy_menu_open");
    await hideWindowByLabel(WIDGET_MENU_WINDOW_LABEL);
  }, []);

  const openWidgetMenu = useCallback(async (sourceWindowLabel?: string, anchor?: { x: number; y: number; width: number; height: number }) => {
    if (menuOpenRef.current) {
      await closeWidgetMenu();
      return;
    }

    if (Date.now() - menuClosedAtRef.current < 300) {
      return;
    }

    console.info("open widget menu requested");
    try {
      await invoke("open_widget_menu_window");
      console.info("open widget menu window invoked");
      await positionWidgetMenuWindow(sourceWindowLabel, anchor);
      await emitWidgetMenuState(modeRef.current);
      menuOpenRef.current = true;
      setMenuOpen(true);
    } catch (error) {
      console.error("failed to open widget menu window", error);
    }
  }, [closeWidgetMenu]);

  const toggleToolbarLayoutMode = useCallback(async () => {
    const nextMode: ToolbarLayoutMode = toolbarLayoutModeRef.current === "normal" ? "minimalist" : "normal";
    toolbarLayoutModeRef.current = nextMode;
    setToolbarLayoutMode(nextMode);

    if (nextMode === "normal") {
      toolbarWindowOpenRef.current = false;
      await hideWindowByLabel(FLOATING_TOOLBAR_WINDOW_LABEL);
      return;
    }

    await closeWidgetMenu();
  }, [closeWidgetMenu]);

  const closeCardSettings = useCallback(async () => {
    cardSettingsWindowOpenRef.current = false;
    selectedCardRef.current = null;
    setSelectedCard(null);
    setActiveCellId(null);
    await invoke("clear_proxy_active_card");
    await hideWindowByLabel(CARD_SETTINGS_WINDOW_LABEL);
  }, []);

  const openCardSettings = useCallback(async (card: SelectedCard) => {
    if (cardSettingsWindowOpenRef.current && selectedCardRef.current && isSameSelectedCard(selectedCardRef.current, card)) {
      await closeCardSettings();
      return;
    }

    console.info("open card settings requested", card);
    const draft = createDraftForCard(schedule, card, settings.term);
    selectedCardRef.current = card;
    cardDraftRef.current = draft;
    setSelectedCard(card);
    setCardDraft(draft);
    menuOpenRef.current = false;
    setMenuOpen(false);

    try {
      await invoke("open_card_settings_window");
      console.info("open card settings window invoked");
      cardSettingsWindowOpenRef.current = true;
      await emitTo<CardSettingsWindowStatePayload>(CARD_SETTINGS_WINDOW_LABEL, CARD_SETTINGS_WINDOW_STATE_EVENT, {
        selectedCard: card,
        draft,
        mergeState: getCourseCardMergeState(schedule, card),
      });
    } catch (error) {
      console.error("failed to open card settings window", error);
    }
  }, [closeCardSettings, schedule, settings.term]);

  useEffect(() => {
    const unlistenUpdate = listen<SettingsWindowUpdatePayload>(SETTINGS_WINDOW_UPDATE_EVENT, (event) => {
      const nextSettings = event.payload.settings;
      const shouldResizeWidget = nextSettings.periodCount !== settingsRef.current.periodCount;

      settingsRef.current = nextSettings;
      settingsSectionRef.current = normalizeSettingsSection(event.payload.activeSection);
      setSettingsSection(normalizeSettingsSection(event.payload.activeSection));
      setSettings(nextSettings);

      if (!shouldResizeWidget) {
        return;
      }

      const visibleScheduleForRows = applyPeriodCountToSchedule(scheduleRef.current, nextSettings.periodCount);
      const scaleFactor = window.devicePixelRatio || 1;
      const measuredRowHeight = measureCurrentCourseRowHeight();
      if (measuredRowHeight) {
        courseRowHeightRef.current = courseRowHeightRef.current ?? measuredRowHeight;
      }
      const rowHeight = Math.round((courseRowHeightRef.current ?? measuredRowHeight ?? DEFAULT_COURSE_ROW_HEIGHT) * scaleFactor);
      void resizeDetachedWidgetToSchedule(visibleScheduleForRows, rowHeight);
    });

    const unlistenRequest = listen<SettingsWindowStateRequestPayload>(SETTINGS_WINDOW_STATE_REQUEST_EVENT, (event) => {
      void emitTo<SettingsWindowStatePayload>(event.payload.windowLabel, SETTINGS_WINDOW_STATE_EVENT, {
        settings: settingsRef.current,
        activeSection: normalizeSettingsSection(settingsSectionRef.current),
      });
    });

    const unlistenClose = listen(SETTINGS_WINDOW_CLOSE_EVENT, () => {
      settingsWindowOpenRef.current = false;
    });

    return () => {
      void unlistenUpdate.then((unlisten) => unlisten());
      void unlistenRequest.then((unlisten) => unlisten());
      void unlistenClose.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const unlistenClose = listen(WIDGET_MENU_CLOSE_EVENT, () => {
      menuClosedAtRef.current = Date.now();
      menuOpenRef.current = false;
      setMenuOpen(false);
    });

    return () => {
      void unlistenClose.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!settingsWindowOpenRef.current) {
      return;
    }

    void emitTo<SettingsWindowStatePayload>(SETTINGS_WINDOW_LABEL, SETTINGS_WINDOW_STATE_EVENT, {
      settings,
      activeSection: normalizeSettingsSection(settingsSection),
    });
  }, [settings, settingsSection]);

  useEffect(() => {
    void syncFloatingToolbarState();
  }, [computedWeek, menuOpen, mode, syncFloatingToolbarState, toolbarLayoutMode]);

  useEffect(() => {
    const unlistenUpdate = listen<CardSettingsWindowUpdatePayload>(CARD_SETTINGS_WINDOW_UPDATE_EVENT, (event) => {
      setSelectedCard(event.payload.selectedCard);
      setCardDraft(event.payload.draft);
      setSchedule((current) => {
        const nextSchedule = applyCardDraft(current, event.payload.selectedCard, event.payload.draft);
        scheduleRef.current = nextSchedule;
        void emitCardSettingsState(event.payload.windowLabel, event.payload.selectedCard, event.payload.draft, nextSchedule);
        return nextSchedule;
      });
    });

    const unlistenAction = listen<CardSettingsWindowActionPayload>(CARD_SETTINGS_WINDOW_ACTION_EVENT, (event) => {
      const nextSchedule = applyCourseCardAction(scheduleRef.current, event.payload.selectedCard, event.payload.action);
      const nextDraft = createDraftForCard(nextSchedule, event.payload.selectedCard, settingsRef.current.term);
      scheduleRef.current = nextSchedule;
      cardDraftRef.current = nextDraft;
      setSchedule(nextSchedule);
      setCardDraft(nextDraft);
      void emitCardSettingsState(event.payload.windowLabel, event.payload.selectedCard, nextDraft, nextSchedule);
    });

    const unlistenRequest = listen<CardSettingsWindowStateRequestPayload>(CARD_SETTINGS_WINDOW_STATE_REQUEST_EVENT, (event) => {
      const currentCard = selectedCardRef.current;
      if (!currentCard) {
        return;
      }

      void emitTo<CardSettingsWindowStatePayload>(event.payload.windowLabel, CARD_SETTINGS_WINDOW_STATE_EVENT, {
        selectedCard: currentCard,
        draft: cardDraftRef.current,
        mergeState: getCourseCardMergeState(scheduleRef.current, currentCard),
      });
    });

    const unlistenClose = listen(CARD_SETTINGS_WINDOW_CLOSE_EVENT, () => {
      cardSettingsWindowOpenRef.current = false;
      selectedCardRef.current = null;
      setSelectedCard(null);
    });

    return () => {
      void unlistenUpdate.then((unlisten) => unlisten());
      void unlistenAction.then((unlisten) => unlisten());
      void unlistenRequest.then((unlisten) => unlisten());
      void unlistenClose.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<DesktopInputEvent>("desktop-input", (event) => {
      const payload = event.payload;

      if (payload.kind === "hover" || payload.kind === "move") {
        setHovered(true);
      }

      if (payload.kind === "leave") {
        setHovered(false);
      }

      if (payload.kind !== "click") {
        return;
      }

      if (modeRef.current === "attached") {
        return;
      }

      setHovered(true);
      const hit = resolveForwardedClickHit(payload, scaleFactorRef.current);

      if (hit.menuButton) {
        void openWidgetMenu();
        return;
      }

      if (menuOpenRef.current && hit.menuAction === "settings") {
        void openSettings();
        return;
      }

      if (menuOpenRef.current && hit.menuAction === "mode") {
        void switchMode();
        return;
      }

      if (menuOpenRef.current && hit.menuAction === "close") {
        void hideScheduleWidget();
        return;
      }

      if (menuOpenRef.current) {
        void closeWidgetMenu();
        return;
      }

      if (hit.editableCard) {
        const key = selectedCardKey(hit.editableCard);
        const now = Date.now();
        const previous = lastForwardedCardClickRef.current;
        lastForwardedCardClickRef.current = { key, time: now };

        if (hit.editableCard.type === "course") {
          setActiveCellId(hit.editableCard.courseId);
        }

        if (previous?.key === key && now - previous.time <= 320) {
          void openCardSettings(hit.editableCard);
        }
      }
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [closeWidgetMenu, hideScheduleWidget, openCardSettings, openSettings, openWidgetMenu, switchMode]);

  useEffect(() => {
    const publishHitboxes = () => {
      if (modeRef.current !== "attached") {
        return;
      }

      const hitboxes = collectProxyHitboxes();
      void emitTo(INTERACTION_PROXY_LABEL, PROXY_HITBOXES_EVENT, hitboxes);
      void invoke("update_proxy_hitboxes", {
        update: {
          cssWidth: window.innerWidth || document.documentElement.clientWidth,
          cssHeight: window.innerHeight || document.documentElement.clientHeight,
          hitboxes,
        },
      });
    };

    publishHitboxes();
    const timer = window.setInterval(publishHitboxes, 250);
    window.addEventListener("resize", publishHitboxes);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", publishHitboxes);
    };
  }, [menuOpen, visibleSchedule, activeCellId]);

  useEffect(() => {
    window.__teacherScheduleProxyTrigger = (hit: ProxyWidgetHit) => {
      handleProxyWidgetHit(
        hit,
        openFloatingToolbarWindow,
        openWidgetMenu,
        toggleToolbarLayoutMode,
        openCardSettings,
        setActiveCellId,
        setMenuOpen,
      );
    };

    const unlistenPromise = listen<ProxyWidgetHit>(PROXY_TRIGGER_EVENT, (event) => {
      const hit = event.payload;
      console.info("proxy trigger", hit);
      handleProxyWidgetHit(
        hit,
        openFloatingToolbarWindow,
        openWidgetMenu,
        toggleToolbarLayoutMode,
        openCardSettings,
        setActiveCellId,
        setMenuOpen,
      );
    });

    return () => {
      if (window.__teacherScheduleProxyTrigger) {
        delete window.__teacherScheduleProxyTrigger;
      }
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [openCardSettings, openFloatingToolbarWindow, openWidgetMenu, toggleToolbarLayoutMode]);

  useEffect(() => {
    const unlistenPromise = listen<WidgetMenuAction>(WIDGET_MENU_ACTION_EVENT, (event) => {
      if (event.payload === "settings") {
        void openSettings();
        return;
      }

      if (event.payload === "mode") {
        void switchMode();
        return;
      }

      if (event.payload === "hide") {
        void hideScheduleWidget();
      }
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [hideScheduleWidget, openSettings, switchMode]);

  useEffect(() => {
    const unlistenPromise = listen<FloatingToolbarActionPayload>(FLOATING_TOOLBAR_ACTION_EVENT, (event) => {
      const action = event.payload.action;
      const sourceWindowLabel = event.payload.windowLabel;
      const anchor = event.payload.anchor;

      if (action === "previous-week") {
        void stepWeek(-1);
        return;
      }

      if (action === "next-week") {
        void stepWeek(1);
        return;
      }

      if (action === "layout") {
        void toggleToolbarLayoutMode();
        return;
      }

      if (action === "menu") {
        void openWidgetMenu(sourceWindowLabel, anchor);
      }
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [openWidgetMenu, switchMode, toggleToolbarLayoutMode]);

  useEffect(() => {
    const unlistenPromise = listen(FLOATING_TOOLBAR_CLOSE_EVENT, () => {
      toolbarWindowOpenRef.current = false;
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const onCourseClick = (courseId: string) => {
    if (mode === "detached") {
      setActiveCellId(courseId);
    }
  };

  const updateCardDraft = (nextDraft: CardDraft) => {
    setCardDraft(nextDraft);
    setSchedule((current) => applyCardDraft(current, selectedCard, nextDraft));
  };

  const onPointerMove = () => {
    if (mode === "detached") {
      setHovered(true);
    }
  };

  const onPointerLeave = () => {
    if (mode === "detached") {
      setHovered(false);
    }
  };

  const startWindowDrag = async (event: PointerEvent<HTMLDivElement>) => {
    if (mode !== "detached" || event.button !== 0) {
      return;
    }

    await appWindow.startDragging();
  };

  const startWindowResize = async (event: PointerEvent<HTMLDivElement>) => {
    if (mode !== "detached" || event.button !== 0) {
      return;
    }

    await appWindow.startResizeDragging("SouthEast");
  };

  const stepWeek = async (delta: number) => {
    setWeekOffset((current) => {
      const baseWeek = calculateWeekNumber(settingsRef.current.term.startDate, new Date());
      const nextOffset = Math.max(1, baseWeek + current + delta) - baseWeek;
      return nextOffset;
    });
  };

  const themeStyle = {
    ...activeSkin.tokens,
    "--panel-opacity": "0.9",
    "--day-count": visibleSchedule.days.length,
  } as CSSProperties;

  return (
    <main
      ref={rootRef}
      className="widget-root"
      style={themeStyle}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <ScheduleWidget
        schedule={visibleSchedule}
        widgetTitle={activeWidget?.title ?? visibleSchedule.teacherName}
        mode={mode}
        menuOpen={menuOpen}
        hovered={hovered}
        activeCellId={activeCellId}
        menuButtonRef={menuButtonRef}
        widgetStyle={widgetStyle}
        backgroundMode={normalizedAppearance.backgroundMode}
        toolbarLayoutMode={toolbarLayoutMode}
        onPreviousWeek={() => void stepWeek(-1)}
        onNextWeek={() => void stepWeek(1)}
        onToggleFloatingToolbar={openFloatingToolbarWindow}
        onToggleLayoutMode={toggleToolbarLayoutMode}
        onToggleMenu={openWidgetMenu}
        onCourseClick={onCourseClick}
        onCardEdit={openCardSettings}
        onDragStart={startWindowDrag}
        onResizeStart={startWindowResize}
      />
    </main>
  );
}

function getVisibleDays(mode: WorkdayMode): Schedule["days"] {
  if (mode === "mon-sun") {
    return allScheduleDays;
  }

  if (mode === "mon-sat") {
    return allScheduleDays.slice(0, 6);
  }

  return allScheduleDays.slice(0, 5);
}

function normalizeSettingsSection(section: SettingsSection | string): SettingsSection {
  return section === "term" || section === "appearance" ? section : "schedule";
}

function limitScheduleRows(scheduleRows: Schedule["rows"], periodCount: number): Schedule["rows"] {
  const count = Math.max(1, Math.min(periodCount, 12));
  const rows = [...scheduleRows.slice(0, count)];

  while (rows.length < count) {
    const previous = rows[rows.length - 1];
    rows.push(createFallbackRow(rows.length + 1, previous));
  }

  return rows;
}

function applyPeriodCountToSchedule(schedule: Schedule, periodCount: number): Schedule {
  return {
    ...schedule,
    rows: limitScheduleRows(schedule.rows, periodCount),
  };
}

function createFallbackRow(order: number, previous?: ScheduleRow): ScheduleRow {
  const minutes = previous ? timeToMinutes(previous.period.time.split("-")[1]) : 480 + (order - 1) * 55;
  const start = minutes;
  const end = minutes + 45;
  const startLabel = minutesToTime(start);
  const endLabel = minutesToTime(end);

  return {
    id: `row-auto-${order}`,
    period: {
      id: `row-auto-${order}`,
      label: `第${order}节`,
      time: `${startLabel}-${endLabel}`,
    },
    courses: Object.fromEntries(
      allScheduleDays.map((day) => [
        day.id,
        {
          id: `row-auto-${order}-${day.id}`,
          title: "",
          room: "",
          colSpan: 1,
          scheduleRule: {
            weekPattern: "all",
            applyWholeTerm: true,
          },
        } satisfies CourseCell,
      ]),
    ) as Record<Weekday, CourseCell>,
  };
}

function minutesToTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return 0;
  }

  return hours * 60 + minutes;
}
function updateActiveWidgetMode(registry: WidgetRegistryState, mode: WindowMode): WidgetRegistryState {
  return {
    ...registry,
    widgets: registry.widgets.map((widget) =>
      widget.id === registry.activeWidgetId ? { ...widget, mode } : widget,
    ),
  };
}

async function emitWidgetMenuState(mode: WindowMode) {
  await emitTo<WidgetMenuStatePayload>(WIDGET_MENU_WINDOW_LABEL, WIDGET_MENU_STATE_EVENT, { mode });
}

async function closeWindowByLabel(label: string) {
  const window = await WebviewWindow.getByLabel(label);
  if (!window) {
    return;
  }

  await window.hide();
}

async function positionFloatingToolbarWindow() {
  const toolbarWindow = await WebviewWindow.getByLabel(FLOATING_TOOLBAR_WINDOW_LABEL);
  const widgetWindow = await WebviewWindow.getByLabel(WIDGET_WINDOW_LABEL);
  if (!toolbarWindow || !widgetWindow) {
    return;
  }

  const outer = await widgetWindow.outerPosition();
  const size = await widgetWindow.outerSize();
  const scaleFactor = window.devicePixelRatio || 1;
  const outerPadding = Math.round(18 * scaleFactor);
  const toolbarWidth = Math.max(180, Math.round(size.width - outerPadding * 2));
  const toolbarHeight = Math.round(34 * scaleFactor);
  const x = outer.x + outerPadding;
  const y = outer.y - toolbarHeight;
  await toolbarWindow.setPosition(new PhysicalPosition(x, y));
  await toolbarWindow.setSize(new PhysicalSize(toolbarWidth, toolbarHeight));
}

function collectProxyHitboxes() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-menu-button], [data-header-toggle], [data-toolbar-action], [data-course-id], [data-period-id]",
    ),
  )
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const courseId = element.dataset.courseId;
      const periodId = element.dataset.periodId;
      const toolbarAction = element.dataset.toolbarAction;
      const kind = element.dataset.menuButton
        ? "menu-button"
        : element.dataset.headerToggle
          ? "header-toggle"
          : toolbarAction === "layout-toggle"
            ? toolbarAction
            : courseId
              ? "course"
              : "period";

      return {
        kind,
        id: courseId ?? periodId,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    })
    .filter((hitbox) => hitbox.right > hitbox.left && hitbox.bottom > hitbox.top);
}

async function hideWindowByLabel(label: string) {
  const window = await WebviewWindow.getByLabel(label);
  if (!window) {
    return;
  }

  await window.hide();
}

function isSameSelectedCard(left: SelectedCard, right: SelectedCard): boolean {
  switch (left.type) {
    case "course":
      return right.type === "course" && left.courseId === right.courseId;
    case "period":
      return right.type === "period" && left.periodId === right.periodId;
  }
}

function selectedCardKey(card: SelectedCard): string {
  return card.type === "course" ? `course:${card.courseId}` : `period:${card.periodId}`;
}

function handleProxyWidgetHit(
  hit: ProxyWidgetHit,
  openFloatingToolbarWindow: () => void,
  openWidgetMenu: () => Promise<void>,
  toggleToolbarLayoutMode: () => Promise<void>,
  openCardSettings: (card: SelectedCard) => Promise<void>,
  setActiveCellId: (value: string | null) => void,
  setMenuOpen: (value: boolean) => void,
) {
  if (hit.kind === "menu-button") {
    void openWidgetMenu();
    return;
  }

  if (hit.kind === "header-toggle") {
    openFloatingToolbarWindow();
    return;
  }

  if (hit.kind === "layout-toggle") {
    void toggleToolbarLayoutMode();
    return;
  }

  setMenuOpen(false);

  if (hit.kind === "course" && hit.id) {
    setActiveCellId(hit.id);
    void openCardSettings({ type: "course", courseId: hit.id });
    return;
  }

  if (hit.kind === "period" && hit.id) {
    void openCardSettings({ type: "period", periodId: hit.id });
    return;
  }
}

async function positionWidgetMenuWindow(
  sourceWindowLabel?: string,
  anchor?: { x: number; y: number; width: number; height: number },
) {
  const menuWindow = await WebviewWindow.getByLabel(WIDGET_MENU_WINDOW_LABEL);
  if (!menuWindow) {
    return;
  }

  const scaleFactor = window.devicePixelRatio || 1;
  const width = 132;
  const height = 132;
  const fallbackButton = document.querySelector<HTMLButtonElement>("[data-menu-button]");
  const rect = anchor ? { right: anchor.x + anchor.width, bottom: anchor.y + anchor.height } : fallbackButton?.getBoundingClientRect();
  if (!rect) {
    return;
  }

  const x = anchor
    ? Math.max(8, Math.round(rect.right - Math.round((width * scaleFactor) / 2)))
    : Math.max(8, Math.round((window.screenX + rect.right) * scaleFactor - Math.round((width * scaleFactor) / 2)));
  const y = anchor
    ? Math.max(8, Math.round(rect.bottom + 8))
    : Math.max(8, Math.round((window.screenY + rect.bottom) * scaleFactor + 8));

  await menuWindow.setPosition(new PhysicalPosition(x, y));
  await menuWindow.setSize(new PhysicalSize(Math.round(width * scaleFactor), Math.round(height * scaleFactor)));
}

function measureCurrentCourseRowHeight(): number | null {
  const row = document.querySelector<HTMLElement>(".timetable-period-column .column-item");
  if (!row) {
    return null;
  }

  return Math.round(row.getBoundingClientRect().height);
}

async function resizeDetachedWidgetToSchedule(schedule: Schedule, rowHeight: number) {
  const widgetWindow = await WebviewWindow.getByLabel("widget");
  if (!widgetWindow) {
    return;
  }

  const scaleFactor = window.devicePixelRatio || 1;
  const outer = await widgetWindow.outerSize();
  const inner = await widgetWindow.innerSize();
  const chromeWidth = Math.max(0, outer.width - inner.width);
  const chromeHeight = Math.max(0, outer.height - inner.height);
  const toolbarHeight = Math.round(34 * scaleFactor);
  const dateRowHeight = Math.round(48 * scaleFactor);
  const outerPadding = Math.round(16 * scaleFactor);
  const contentPadding = Math.round(14 * scaleFactor);
  const contentGap = Math.round(12 * scaleFactor);

  const innerHeight =
    outerPadding * 2 +
    toolbarHeight +
    dateRowHeight +
    rowHeight * Math.max(1, schedule.rows.length) +
    contentGap * 2 +
    contentPadding * 2;
  const innerWidth = inner.width;

  await widgetWindow.setSize(new PhysicalSize(Math.round(innerWidth + chromeWidth), Math.round(innerHeight + chromeHeight)));
  await invoke("sync_active_widget_bounds");
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

function buildWidgetStyle(appearance: WidgetSettingsState["appearance"], schedule: Schedule): CSSProperties {
  const normalizedAppearance = normalizeAppearanceSettings(appearance);
  const gridLineOpacity = String(normalizedAppearance.gridLineOpacity / 100);
  const blurIntensity = normalizedAppearance.backgroundMode === "blur" ? normalizedAppearance.blurIntensity : 0;
  const blurMix = clamp01(blurIntensity / 40);
  const backgroundFill = buildRgbaColor(
    normalizedAppearance.backgroundColor,
    normalizedAppearance.backgroundOpacity / 100,
  );
  const mist = blurMix * 0.48;
  const mistHighlight = blurMix * 0.22;
  const brightness = 100 + Math.round(blurMix * 4);
  const saturation = 100 + Math.round(blurMix * 12);
  const gridLineBorder = buildGridLineBorder(
    normalizedAppearance.gridLineType,
    normalizedAppearance.gridLineColor,
    normalizedAppearance.gridLineWidth,
    normalizedAppearance.gridLineOpacity,
  );
  return {
    "--column-gap": `${normalizedAppearance.columnGap}px`,
    "--schedule-row-count": Math.max(1, schedule.rows.length),
    "--widget-background-mode": normalizedAppearance.backgroundMode,
    "--widget-background-color": normalizedAppearance.backgroundColor,
    "--widget-background-fill": backgroundFill,
    "--widget-background-opacity": String(normalizedAppearance.backgroundOpacity / 100),
    "--widget-blur-intensity": `${normalizedAppearance.blurIntensity}px`,
    "--widget-blur-overlay": blurMix > 0 ? String(mist) : "0",
    "--widget-blur-highlight": blurMix > 0 ? String(mistHighlight) : "0",
    "--widget-background-brightness": `${brightness}%`,
    "--widget-background-saturation": `${saturation}%`,
    "--row-divider": normalizedAppearance.gridLineColor,
    "--row-divider-rgb": hexToRgbParts(normalizedAppearance.gridLineColor),
    "--row-divider-opacity": gridLineOpacity,
    "--row-divider-style": normalizedAppearance.gridLineType,
    "--row-divider-thickness": `${normalizedAppearance.gridLineWidth}px`,
    "--row-divider-offset": `${normalizedAppearance.rowDividerHeight}px`,
    "--schedule-card-radius": `${normalizedAppearance.cardRadius}px`,
    "--schedule-card-shadow": mapCardShadowStrength(normalizedAppearance.cardShadowStrength),
    "--schedule-grid-line-style": normalizedAppearance.gridLineType,
    "--schedule-grid-line-color": normalizedAppearance.gridLineColor,
    "--schedule-grid-line-width": `${normalizedAppearance.gridLineWidth}px`,
    "--schedule-grid-line-opacity": gridLineOpacity,
    "--schedule-grid-line-border": gridLineBorder,
  } as CSSProperties;
}

function buildGridLineBorder(type: "none" | "solid" | "dashed" | "dotted", color: string, width: number, opacity: number): string {
  if (type === "none" || opacity <= 0 || width <= 0) {
    return "none";
  }

  const rgb = hexToRgbParts(color)
    .split(" ")
    .map((channel) => Number.parseInt(channel, 10))
    .filter((channel) => Number.isFinite(channel));

  if (rgb.length !== 3) {
    return `${Math.max(0.5, width)}px ${type} rgba(229, 234, 242, ${opacity / 100})`;
  }

  return `${Math.max(0.5, width)}px ${type} rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${opacity / 100})`;
}


function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function buildRgbaColor(value: string, alpha: number): string {
  const rgb = hexToRgbParts(value)
    .split(" ")
    .map((channel) => Number.parseInt(channel, 10));

  if (rgb.length !== 3 || rgb.some((channel) => !Number.isFinite(channel))) {
    return `rgba(219, 231, 239, ${clamp01(alpha)})`;
  }

  return `rgba(${clampRgbChannel(rgb[0])}, ${clampRgbChannel(rgb[1])}, ${clampRgbChannel(rgb[2])}, ${clamp01(alpha)})`;
}

function clampRgbChannel(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(255, value));
}

function mapCardShadowStrength(strength: number): string {
  switch (strength) {
    case 0:
      return "none";
    case 1:
      return "0 2px 6px rgba(15, 23, 42, 0.05)";
    case 2:
      return "0 4px 12px rgba(15, 23, 42, 0.09)";
    case 3:
      return "0 8px 20px rgba(15, 23, 42, 0.13)";
    case 4:
    default:
      return "0 12px 28px rgba(15, 23, 42, 0.18)";
  }
}

function hexToRgbParts(value: string): string {
  const normalized = value.trim();
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized);
  if (!match) {
    return "102 91 78";
  }

  return `${parseInt(match[1], 16)} ${parseInt(match[2], 16)} ${parseInt(match[3], 16)}`;
}

function createDraftForCard(
  schedule: Schedule,
  card: SelectedCard,
  term: WidgetSettingsState["term"],
): CardDraft {
  const base = { ...defaultCardDraft, startDate: term.startDate, endDate: term.endDate };

  if (card.type === "course") {
    const course = findCourse(schedule, card.courseId);
    return {
      ...base,
      title: course?.title ?? "",
      secondary: course?.room ?? "",
      backgroundColor: course?.style?.backgroundColor ?? "#fff8e1",
      color: course?.style?.color ?? "#b97916",
      fontFamily: course?.style?.fontFamily ?? base.fontFamily,
      fontSize: course?.style?.fontSize ?? base.fontSize,
      weekPattern: course?.scheduleRule?.weekPattern ?? "all",
      applyWholeTerm: course?.scheduleRule?.applyWholeTerm ?? true,
      startDate: course?.scheduleRule?.startDate ?? term.startDate,
      endDate: course?.scheduleRule?.endDate ?? term.endDate,
    };
  }

  if (card.type === "period") {
    const period = findPeriod(schedule, card.periodId);
    return {
      ...base,
      title: period?.label ?? "",
      secondary: period?.time ?? "",
      backgroundColor: period?.style?.backgroundColor ?? "#ffffff",
      color: period?.style?.color ?? "#ffffff",
      fontFamily: period?.style?.fontFamily ?? base.fontFamily,
      fontSize: period?.style?.fontSize ?? 12,
    };
  }
  return base;
}

function applyCardDraft(schedule: Schedule, selectedCard: SelectedCard | null, draft: CardDraft): Schedule {
  if (!selectedCard) {
    return schedule;
  }

  const style = toCardStyle(draft);
  const rows = schedule.rows.map((row) => applyDraftToRow(row, selectedCard, draft, style));
  return { ...schedule, rows };
}

function emitCardSettingsState(windowLabel: string, selectedCard: SelectedCard, draft: CardDraft, schedule: Schedule) {
  return emitTo<CardSettingsWindowStatePayload>(windowLabel, CARD_SETTINGS_WINDOW_STATE_EVENT, {
    selectedCard,
    draft,
    mergeState: getCourseCardMergeState(schedule, selectedCard),
  });
}

function getCourseCardMergeState(schedule: Schedule, selectedCard: SelectedCard): CourseCardMergeState {
  if (selectedCard.type !== "course") {
    return { canMergeRight: false, canSplit: false };
  }

  const location = findCourseLocation(schedule, selectedCard.courseId);
  if (!location) {
    return { canMergeRight: false, canSplit: false, reason: "未找到课程卡片" };
  }

  const course = location.course;
  const canSplit = (course.colSpan ?? 1) > 1;
  const rightCourse = findRightNeighbor(location);
  const canMergeRight = Boolean(rightCourse && canMergeCourses(course, rightCourse));
  const reason = canMergeRight || canSplit ? undefined : "右侧相邻卡片内容不一致";
  return { canMergeRight, canSplit, reason };
}

function applyCourseCardAction(schedule: Schedule, selectedCard: SelectedCard, action: CardSettingsWindowActionPayload["action"]): Schedule {
  if (selectedCard.type !== "course") {
    return schedule;
  }

  if (action === "merge-right") {
    return mergeCourseCardRight(schedule, selectedCard.courseId);
  }

  return splitCourseCard(schedule, selectedCard.courseId);
}

function applyDraftToRow(
  row: ScheduleRow,
  selectedCard: SelectedCard,
  draft: CardDraft,
  style: CardStyle,
): ScheduleRow {
  if (selectedCard.type === "period" && selectedCard.periodId === row.period.id) {
    return { ...row, period: { ...row.period, label: draft.title, time: draft.secondary, style } };
  }

  if (selectedCard.type !== "course") {
    return row;
  }

  const courses = Object.fromEntries(
    Object.entries(row.courses).map(([weekday, course]) => [
      weekday,
      course.id === selectedCard.courseId || course.mergedInto === selectedCard.courseId
        ? {
            ...course,
            title: draft.title,
            room: draft.secondary,
            style,
            scheduleRule: {
              weekPattern: draft.weekPattern,
              applyWholeTerm: draft.applyWholeTerm,
              startDate: draft.applyWholeTerm ? undefined : draft.startDate,
              endDate: draft.applyWholeTerm ? undefined : draft.endDate,
            } satisfies CourseScheduleRule,
          }
        : course,
    ]),
  ) as Record<Weekday, CourseCell>;

  return { ...row, courses };
}

type CourseLocation = {
  rowIndex: number;
  weekday: Weekday;
  weekdayIndex: number;
  row: ScheduleRow;
  course: CourseCell;
  weekdays: Weekday[];
};

function findCourseLocation(schedule: Schedule, courseId: string): CourseLocation | null {
  const weekdays = schedule.days.map((day) => day.id);
  for (const [rowIndex, row] of schedule.rows.entries()) {
    for (const [weekdayIndex, weekday] of weekdays.entries()) {
      const course = row.courses[weekday];
      if (course?.id === courseId) {
        return { rowIndex, weekday, weekdayIndex, row, course, weekdays };
      }
    }
  }

  return null;
}

function findRightNeighbor(location: CourseLocation): CourseCell | null {
  const nextWeekday = location.weekdays[location.weekdayIndex + (location.course.colSpan ?? 1)];
  return nextWeekday ? location.row.courses[nextWeekday] ?? null : null;
}

function canMergeCourses(left: CourseCell, right: CourseCell): boolean {
  return !left.mergedInto && !right.mergedInto && (right.colSpan ?? 1) === 1 && left.title === right.title && (left.room ?? "") === (right.room ?? "");
}

function mergeCourseCardRight(schedule: Schedule, courseId: string): Schedule {
  const location = findCourseLocation(schedule, courseId);
  const rightCourse = location ? findRightNeighbor(location) : null;
  if (!location || !rightCourse || !canMergeCourses(location.course, rightCourse)) {
    return schedule;
  }

  const rightWeekday = location.weekdays[location.weekdayIndex + (location.course.colSpan ?? 1)];
  if (!rightWeekday) {
    return schedule;
  }

  const rows = schedule.rows.map((row, rowIndex) => {
    if (rowIndex !== location.rowIndex) {
      return row;
    }

    return {
      ...row,
      courses: {
        ...row.courses,
        [location.weekday]: {
          ...location.course,
          colSpan: (location.course.colSpan ?? 1) + 1,
        },
        [rightWeekday]: {
          ...rightCourse,
          mergedInto: location.course.id,
        },
      },
    };
  });

  return { ...schedule, rows };
}

function splitCourseCard(schedule: Schedule, courseId: string): Schedule {
  const location = findCourseLocation(schedule, courseId);
  if (!location || (location.course.colSpan ?? 1) <= 1) {
    return schedule;
  }

  const span = location.course.colSpan ?? 1;
  const coveredWeekdays = location.weekdays.slice(location.weekdayIndex + 1, location.weekdayIndex + span);
  const rows = schedule.rows.map((row, rowIndex) => {
    if (rowIndex !== location.rowIndex) {
      return row;
    }

    const courses = { ...row.courses };
    courses[location.weekday] = { ...location.course, colSpan: 1 };
    for (const weekday of coveredWeekdays) {
      courses[weekday] = {
        ...courses[weekday],
        title: location.course.title,
        room: location.course.room,
        style: location.course.style,
        scheduleRule: location.course.scheduleRule,
        colSpan: 1,
        mergedInto: undefined,
      };
    }

    return { ...row, courses };
  });

  return { ...schedule, rows };
}

function findCourse(schedule: Schedule, courseId: string): CourseCell | undefined {
  return findCourseLocation(schedule, courseId)?.course;
}

function findPeriod(schedule: Schedule, periodId: string): PeriodInfo | undefined {
  const row = schedule.rows.find((item) => item.period.id === periodId);
  if (row) {
    return row.period;
  }

  return undefined;
}

type ForwardedClickHit = {
  menuButton: boolean;
  headerToggle: boolean;
  menuAction: "settings" | "mode" | "close" | null;
  editableCard: SelectedCard | null;
};

function resolveForwardedClickHit(payload: DesktopInputEvent, scaleFactor: number): ForwardedClickHit {
  /*
    The Rust forwarder emits HWND-local physical pixels. Browser hit testing uses
    CSS pixels. We try several conversions because WebView, Explorer reparenting
    and DPI changes can report slightly different coordinate spaces.
  */
  const candidates = createForwardedPointCandidates(payload, scaleFactor);

  for (const point of candidates) {
    const element = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
    const hit = hitTestForwardedElement(element);
    if (hit.menuButton || hit.headerToggle || hit.menuAction || hit.editableCard) {
      return hit;
    }

    const editableCard = findEditableCardByGeometry(point.x, point.y);
    if (editableCard) {
      return { menuButton: false, headerToggle: false, menuAction: null, editableCard };
    }
  }

  return { menuButton: false, headerToggle: false, menuAction: null, editableCard: null };
}

function createForwardedPointCandidates(
  payload: DesktopInputEvent,
  scaleFactor: number,
): Array<{ x: number; y: number }> {
  const cssWidth = window.innerWidth || document.documentElement.clientWidth;
  const cssHeight = window.innerHeight || document.documentElement.clientHeight;
  const scale = Math.max(scaleFactor, 1);
  const candidates = [
    { x: payload.x / scale, y: payload.y / scale },
    { x: payload.x, y: payload.y },
  ];

  if (payload.width > 0 && payload.height > 0 && cssWidth > 0 && cssHeight > 0) {
    candidates.push({
      x: (payload.x / payload.width) * cssWidth,
      y: (payload.y / payload.height) * cssHeight,
    });
  }

  return dedupePoints(candidates);
}

function dedupePoints(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = `${Math.round(point.x)}:${Math.round(point.y)}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function hitTestForwardedElement(element: HTMLElement | null): ForwardedClickHit {
  const menuButton = Boolean(element?.closest("[data-menu-button]"));
  const headerToggle = Boolean(element?.closest("[data-header-toggle]"));
  const menuActionElement = element?.closest<HTMLElement>("[data-menu-action]");
  const editableElement = element?.closest<HTMLElement>("[data-course-id], [data-period-id]");

  const menuAction = readMenuAction(menuActionElement);
  const editableCard = readEditableCard(editableElement);

  return { menuButton, headerToggle, menuAction, editableCard };
}

function readMenuAction(element: HTMLElement | null | undefined): ForwardedClickHit["menuAction"] {
  const action = element?.dataset.menuAction;
  return action === "settings" || action === "mode" || action === "close" ? action : null;
}

function readEditableCard(element: HTMLElement | null | undefined): SelectedCard | null {
  const courseId = element?.dataset.courseId;
  if (courseId) {
    return { type: "course", courseId };
  }

  const periodId = element?.dataset.periodId;
  if (periodId) {
    return { type: "period", periodId };
  }

  return null;
}

function findEditableCardByGeometry(x: number, y: number): SelectedCard | null {
  const elements = document.querySelectorAll<HTMLElement>("[data-course-id], [data-period-id]");

  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      continue;
    }

    return readEditableCard(element);
  }

  return null;
}

