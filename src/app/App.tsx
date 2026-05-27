import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { CSSProperties, MutableRefObject, PointerEvent } from "react";
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
  defaultBlockSettingsState,
  defaultAppearanceSettings,
  type BlockSettingsState,
  type CardDraft,
  type SelectedCard,
  type SettingsSection,
  type WidgetSettingsState,
  toCardStyle,
} from "../features/settings/settingsTypes";
import {
  CARD_SETTINGS_WINDOW_LABEL,
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
  type WidgetMenuAction,
  type WidgetMenuStatePayload,
  type CardSettingsWindowStatePayload,
  type CardSettingsWindowUpdatePayload,
  type CardSettingsWindowStateRequestPayload,
  type SettingsWindowStatePayload,
  type SettingsWindowStateRequestPayload,
  type SettingsWindowUpdatePayload,
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
  term: {
    startDate: "2026-03-05",
    endDate: "2026-06-30",
  },
  blockSettings: defaultBlockSettingsState,
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
  const modeRef = useRef<WindowMode>("attached");

  const [mode, setMode] = useState<WindowMode>("attached");
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("workdays");
  const [settings, setSettings] = useState<WidgetSettingsState>(defaultSettings);
  const [schedule, setSchedule] = useState<Schedule>(mockSchedule);
  const [hovered, setHovered] = useState(false);
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
  const computedWeek = useMemo(() => calculateWeekNumber(settings.term.startDate, new Date()), [settings.term.startDate]);

  const visibleSchedule = useMemo(
    () => ({
      ...schedule,
      weekNumber: computedWeek,
      days: getVisibleDays(settings.workdayMode),
    }),
    [computedWeek, schedule, settings.workdayMode],
  );
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

  const openWidgetMenu = useCallback(async () => {
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
      await positionWidgetMenuWindow();
      await emitWidgetMenuState(modeRef.current);
      menuOpenRef.current = true;
      setMenuOpen(true);
    } catch (error) {
      console.error("failed to open widget menu window", error);
    }
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
      });
    } catch (error) {
      console.error("failed to open card settings window", error);
    }
  }, [closeCardSettings, schedule, settings.term]);

  useEffect(() => {
    const unlistenUpdate = listen<SettingsWindowUpdatePayload>(SETTINGS_WINDOW_UPDATE_EVENT, (event) => {
      const nextSchedule = applyBlockSettingsToSchedule(scheduleRef.current, event.payload.settings.blockSettings);
      const nextSettings = {
        ...event.payload.settings,
        appearance: {
          ...event.payload.settings.appearance,
          blockHeights: buildBlockHeightsFromRows(event.payload.settings.blockSettings),
        },
      };

      const scaleFactor = window.devicePixelRatio || 1;
      const measuredRowHeight = measureCurrentCourseRowHeight();
      if (measuredRowHeight) {
        courseRowHeightRef.current = courseRowHeightRef.current ?? measuredRowHeight;
      }
      const rowHeight = Math.round((courseRowHeightRef.current ?? measuredRowHeight ?? DEFAULT_COURSE_ROW_HEIGHT) * scaleFactor);

      settingsRef.current = nextSettings;
      scheduleRef.current = nextSchedule;
      settingsSectionRef.current = event.payload.activeSection;
      setSettings(nextSettings);
      setSettingsSection(event.payload.activeSection);
      setSchedule(nextSchedule);
      void resizeDetachedWidgetToSchedule(nextSchedule, rowHeight);
    });

    const unlistenRequest = listen<SettingsWindowStateRequestPayload>(SETTINGS_WINDOW_STATE_REQUEST_EVENT, (event) => {
      void emitTo<SettingsWindowStatePayload>(event.payload.windowLabel, SETTINGS_WINDOW_STATE_EVENT, {
        settings: settingsRef.current,
        activeSection: settingsSectionRef.current,
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
      activeSection: settingsSection,
    });
  }, [settings, settingsSection]);

  useEffect(() => {
    const unlistenUpdate = listen<CardSettingsWindowUpdatePayload>(CARD_SETTINGS_WINDOW_UPDATE_EVENT, (event) => {
      setSelectedCard(event.payload.selectedCard);
      setCardDraft(event.payload.draft);
      setSchedule((current) => applyCardDraft(current, event.payload.selectedCard, event.payload.draft));
    });

    const unlistenRequest = listen<CardSettingsWindowStateRequestPayload>(CARD_SETTINGS_WINDOW_STATE_REQUEST_EVENT, (event) => {
      const currentCard = selectedCardRef.current;
      if (!currentCard) {
        return;
      }

      void emitTo<CardSettingsWindowStatePayload>(event.payload.windowLabel, CARD_SETTINGS_WINDOW_STATE_EVENT, {
        selectedCard: currentCard,
        draft: cardDraftRef.current,
      });
    });

    const unlistenClose = listen(CARD_SETTINGS_WINDOW_CLOSE_EVENT, () => {
      cardSettingsWindowOpenRef.current = false;
      selectedCardRef.current = null;
      setSelectedCard(null);
    });

    return () => {
      void unlistenUpdate.then((unlisten) => unlisten());
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
      handleProxyWidgetHit(hit, openWidgetMenu, openCardSettings, setActiveCellId, setMenuOpen, menuOpenRef);
    };

    const unlistenPromise = listen<ProxyWidgetHit>(PROXY_TRIGGER_EVENT, (event) => {
      const hit = event.payload;
      console.info("proxy trigger", hit);
      handleProxyWidgetHit(hit, openWidgetMenu, openCardSettings, setActiveCellId, setMenuOpen, menuOpenRef);
    });

    return () => {
      if (window.__teacherScheduleProxyTrigger) {
        delete window.__teacherScheduleProxyTrigger;
      }
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [openCardSettings, openWidgetMenu]);

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

function collectProxyHitboxes() {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-menu-button], [data-course-id], [data-period-id]"),
  )
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const courseId = element.dataset.courseId;
      const periodId = element.dataset.periodId;
      const kind = element.dataset.menuButton
        ? "menu-button"
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

function handleProxyWidgetHit(
  hit: ProxyWidgetHit,
  openWidgetMenu: () => Promise<void>,
  openCardSettings: (card: SelectedCard) => Promise<void>,
  setActiveCellId: (value: string | null) => void,
  setMenuOpen: (value: boolean) => void,
  menuOpenRef: MutableRefObject<boolean>,
) {
  if (hit.kind === "menu-button") {
    void openWidgetMenu();
    return;
  }

  menuOpenRef.current = false;
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

async function positionWidgetMenuWindow() {
  const menuWindow = await WebviewWindow.getByLabel(WIDGET_MENU_WINDOW_LABEL);
  const button = document.querySelector<HTMLButtonElement>("[data-menu-button]");
  if (!menuWindow || !button) {
    return;
  }

  const rect = button.getBoundingClientRect();
  const scaleFactor = window.devicePixelRatio || 1;
  const width = 132;
  const height = 132;
  const x = Math.max(8, Math.round((window.screenX + rect.right - width) * scaleFactor));
  const y = Math.max(8, Math.round((window.screenY + rect.bottom + 8) * scaleFactor));

  await menuWindow.setPosition(new PhysicalPosition(x, y));
  await menuWindow.setSize(new PhysicalSize(Math.round(width * scaleFactor), Math.round(height * scaleFactor)));
}

function measureCurrentCourseRowHeight(): number | null {
  const row = document.querySelector<HTMLElement>(".course-block .block-column .column-item");
  if (!row) {
    return null;
  }

  return Math.round(row.getBoundingClientRect().height);
}

function buildBlockHeightsFromRows(blockSettings: BlockSettingsState): Record<string, number> {
  return Object.fromEntries(
    blockSettings.blocks.map((block) => [block.id, blockHeightUnits(block)]),
  );
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
  const blockGap = Math.round(14 * scaleFactor);

  const blockHeights = schedule.blocks.map((block) => {
    return Math.max(rowHeight * Math.max(1, block.rows.length), rowHeight);
  });

  const innerHeight =
    outerPadding * 2 +
    toolbarHeight +
    dateRowHeight +
    blockHeights.reduce((sum, height) => sum + height, 0) +
    Math.max(0, schedule.blocks.length - 1) * blockGap +
    contentGap * 2 +
    contentPadding * 2;
  const innerWidth = inner.width;

  await widgetWindow.setSize(new PhysicalSize(Math.round(innerWidth + chromeWidth), Math.round(innerHeight + chromeHeight)));
  await invoke("sync_active_widget_bounds");
}

function blockHeightUnits(block: BlockSettingsState["blocks"][number]): number {
  return block.periods.some((period) => period.type === "merged") ? 1.15 : Math.max(1, block.periods.length);
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
  const blockTracks = schedule.blocks
    .map((block) => {
      const fallback = block.rows.some((row) => row.type === "merged") ? 1.15 : Math.max(1, block.rows.length);
      const height = appearance.blockHeights[block.id] ?? fallback;
      const minHeight = block.rows.some((row) => row.type === "merged") ? "44px" : "0";
      return `minmax(${minHeight}, ${height}fr)`;
    })
    .join(" ");

  return {
    "--column-gap": `${appearance.columnGap}px`,
    "--row-divider": appearance.rowDividerColor,
    "--row-divider-opacity": String(appearance.rowDividerOpacity),
    "--row-divider-style": appearance.rowDividerStyle,
    "--row-divider-thickness": `${appearance.rowDividerThickness}px`,
    "--row-divider-offset": `${appearance.rowDividerHeight}px`,
    "--block-card-bg": appearance.blockCardBackgroundColor,
    "--block-card-radius": `${appearance.blockCardCornerRadius}px`,
    "--schedule-block-tracks": blockTracks,
  } as CSSProperties;
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
  const blocks = schedule.blocks.map((block) => applyDraftToBlock(block, selectedCard, draft, style));
  return { ...schedule, blocks };
}

function applyBlockSettingsToSchedule(schedule: Schedule, nextBlockSettings: BlockSettingsState): Schedule {
  const dayIds = schedule.days.map((day) => day.id);
  const blocks = nextBlockSettings.blocks.map((settingBlock) => {
    const existing = schedule.blocks.find((block) => block.id === settingBlock.id);
    const rowTemplates = existing?.rows ?? [];

    return {
      id: settingBlock.id,
      title: settingBlock.name,
      style: {
        backgroundColor: settingBlock.cardBackgroundColor,
      },
      cardTone: existing?.cardTone ?? "wheat",
      cardCornerRadius: settingBlock.cardCornerRadius,
      rows: settingBlock.periods.map((periodSetting, rowIndex) => {
        const templateRow = rowTemplates.find((item) => item.id === periodSetting.id) ?? rowTemplates[rowIndex];
        if (periodSetting.type === "merged") {
          return {
            id: periodSetting.id,
            type: "merged",
            period: {
              ...(templateRow && templateRow.type === "merged" ? templateRow.period : {}),
              id: periodSetting.id,
              label: periodSetting.name,
              time: `${periodSetting.startTime}-${periodSetting.endTime}`,
            },
            title: settingBlock.name || periodSetting.name,
            subtitle: templateRow && templateRow.type === "merged" ? templateRow.subtitle : "",
            style: {
              backgroundColor: settingBlock.cardBackgroundColor,
            },
          } satisfies ScheduleRow;
        }

        const row = templateRow && templateRow.type === "course" ? templateRow : null;
        return {
          id: `${settingBlock.id}-${periodSetting.id}`,
          type: "course",
          period: {
            ...(row?.period ?? {}),
            id: periodSetting.id,
            label: periodSetting.name,
            time: `${periodSetting.startTime}-${periodSetting.endTime}`,
          },
          courses: Object.fromEntries(
            dayIds.map((weekday) => {
              const course = row?.courses[weekday] ?? createEmptyCourse(settingBlock.id, periodSetting.id, weekday);
              return [
                weekday,
                {
                  ...course,
                  style: {
                    ...course.style,
                    backgroundColor: settingBlock.cardBackgroundColor,
                  },
                },
              ];
            }),
          ) as Record<Weekday, CourseCell>,
        } satisfies ScheduleRow;
      }),
    };
  });

  return { ...schedule, blocks };
}

function createEmptyCourse(blockId: string, periodId: string, weekday: Weekday, backgroundColor = "#fff8e1"): CourseCell {
  return {
    id: `${blockId}-${periodId}-${weekday}`,
    title: "",
    room: "",
    style: {
      backgroundColor,
    },
    scheduleRule: {
      weekPattern: "all",
      applyWholeTerm: true,
    },
  };
}

function applyDraftToBlock(
  block: Schedule["blocks"][number],
  selectedCard: SelectedCard,
  draft: CardDraft,
  style: CardStyle,
): Schedule["blocks"][number] {
  return {
    ...block,
    rows: block.rows.map((row) => {
      if (row.type === "merged") {
        if (selectedCard.type === "period" && selectedCard.periodId === row.period.id) {
          return { ...row, period: { ...row.period, label: draft.title, time: draft.secondary, style }, title: draft.title, subtitle: draft.secondary };
        }

        return row;
      }

      if (selectedCard.type === "period" && selectedCard.periodId === row.period.id) {
        return { ...row, period: { ...row.period, label: draft.title, time: draft.secondary, style } };
      }

      if (selectedCard.type !== "course") {
        return row;
      }

      const courses = Object.fromEntries(
        Object.entries(row.courses).map(([weekday, course]) => [
          weekday,
          course.id === selectedCard.courseId
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
    }),
  };
}

function findCourse(schedule: Schedule, courseId: string): CourseCell | undefined {
  for (const block of schedule.blocks) {
    for (const row of block.rows) {
      if (row.type !== "course") {
        continue;
      }

      const course = Object.values(row.courses).find((item) => item.id === courseId);
      if (course) {
        return course;
      }
    }
  }

  return undefined;
}

function findPeriod(schedule: Schedule, periodId: string): PeriodInfo | undefined {
  for (const block of schedule.blocks) {
    const row = block.rows.find((item) => item.period.id === periodId);
    if (row) {
      return row.period;
    }
  }

  return undefined;
}

type ForwardedClickHit = {
  menuButton: boolean;
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
    if (hit.menuButton || hit.menuAction || hit.editableCard) {
      return hit;
    }

    const editableCard = findEditableCardByGeometry(point.x, point.y);
    if (editableCard) {
      return { menuButton: false, menuAction: null, editableCard };
    }
  }

  return { menuButton: false, menuAction: null, editableCard: null };
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
  const menuActionElement = element?.closest<HTMLElement>("[data-menu-action]");
  const editableElement = element?.closest<HTMLElement>("[data-course-id], [data-period-id]");

  const menuAction = readMenuAction(menuActionElement);
  const editableCard = readEditableCard(editableElement);

  return { menuButton, menuAction, editableCard };
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
