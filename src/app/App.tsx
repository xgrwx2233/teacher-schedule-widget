import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { CSSProperties, PointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScheduleWidget } from "../components/ScheduleWidget/ScheduleWidget";
import type { ToolbarSyncButtonState } from "../components/ScheduleToolbar/ScheduleToolbar";
import {
  defaultLocalAccountState,
  defaultLocalSyncStatus,
  type LocalAccountState,
  type LocalSyncStatus,
  type StoredSchedulePayload,
} from "../features/account/types";
import {
  allScheduleDays,
  mockSchedule,
} from "../features/schedule/mockSchedule";
import type {
  CardStyle,
  CourseCell,
  CourseCardDisplayMode,
  CourseScheduleRule,
  CourseTemporaryChange,
  PeriodInfo,
  Schedule,
  ScheduleRow,
  Weekday,
  WorkdayMode,
} from "../features/schedule/types";
import {
  defaultCardDraft,
  defaultAppearanceSettings,
  computeCoursePalette,
  normalizeAppearanceSettings,
  createDefaultTemporaryChangeDraft,
  type AxisColorMode,
  type CardDraft,
  type CourseCardMergeState,
  type PeriodConfigItem,
  type SelectedCard,
  type SettingsSection,
  type TemporaryChangeDraft,
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
  PERIOD_CARD_SETTINGS_WINDOW_LABEL,
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
  AUTH_STATE_CHANGED_EVENT,
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
  type CardSettingsTitleContext,
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
import type {
  DesktopInputEvent,
  WindowMode,
  WindowModeState,
} from "../features/windowMode/types";
import type { ProxyWidgetHit } from "../features/windowMode/types";

type DesktopWallpaperInfo = {
  path: string | null;
  url: string | null;
  signature: DesktopWallpaperSignature;
  monitorLeft: number;
  monitorTop: number;
  monitorWidth: number;
  monitorHeight: number;
  windowLeft: number;
  windowTop: number;
  windowWidth: number;
  windowHeight: number;
  wallpaperLeft: number;
  wallpaperTop: number;
  wallpaperWidth: number;
  wallpaperHeight: number;
};

type DesktopWallpaperSignature = {
  path: string | null;
  fileSize: number | null;
  modifiedMs: number | null;
  wallpaperPosition: number;
  monitorLeft: number;
  monitorTop: number;
  monitorWidth: number;
  monitorHeight: number;
  wallpaperLeft: number;
  wallpaperTop: number;
  wallpaperWidth: number;
  wallpaperHeight: number;
};

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
const DESKTOP_WALLPAPER_CHANGED_EVENT = "desktop-wallpaper-changed";
const SYNC_SERVER_CHANGE_EVENT = "sync-server-change";
const WALLPAPER_SIGNATURE_CHECK_MS = 5_000;

export function App() {
  const appWindow = useMemo(() => getCurrentWindow(), []);

  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const menuOpenRef = useRef(false);
  const menuClosedAtRef = useRef(0);
  const toolbarWindowOpenRef = useRef(false);
  const toolbarLayoutModeRef = useRef<ToolbarLayoutMode>("normal");
  const modeRef = useRef<WindowMode>("attached");

  const [mode, setMode] = useState<WindowMode>("attached");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toolbarLayoutMode, setToolbarLayoutMode] =
    useState<ToolbarLayoutMode>("normal");
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("schedule");
  const [settings, setSettings] =
    useState<WidgetSettingsState>(defaultSettings);
  const [schedule, setSchedule] = useState<Schedule>(() => mockSchedule);
  const [accountState, setAccountState] = useState<LocalAccountState>(
    defaultLocalAccountState,
  );
  const [localSyncStatus, setLocalSyncStatus] = useState<LocalSyncStatus>(
    defaultLocalSyncStatus,
  );
  const [manualSyncRunning, setManualSyncRunning] = useState(false);
  const [syncTip, setSyncTip] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [schedulePersistenceReady, setSchedulePersistenceReady] =
    useState(false);
  const [scheduleRenderVersion, setScheduleRenderVersion] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null);
  const [cardDraft, setCardDraft] = useState<CardDraft>(defaultCardDraft);
  const [activeSkinId, setActiveSkinId] = useState("midnight-coral");
  const [widgetRegistry, setWidgetRegistry] = useState(defaultWidgetRegistry);
  const [wallpaperInfo, setWallpaperInfo] =
    useState<DesktopWallpaperInfo | null>(null);
  const [wallpaperVersion, setWallpaperVersion] = useState(0);
  const settingsWindowOpenRef = useRef(false);
  const cardSettingsWindowOpenRef = useRef(false);
  const activeCardSettingsWindowLabelRef = useRef<string | null>(null);
  const settingsRef = useRef(settings);
  const scheduleRef = useRef(schedule);
  const accountStateRef = useRef(accountState);
  const localSyncStatusRef = useRef(localSyncStatus);
  const manualSyncRunningRef = useRef(false);
  const syncTipTimerRef = useRef<number | null>(null);
  const suppressNextSchedulePersistenceRef = useRef(false);
  const cardSettingsHasPendingSaveRef = useRef(false);
  const settingsWindowHasPendingScheduleSaveRef = useRef(false);
  const courseRowHeightRef = useRef<number | null>(null);
  const settingsSectionRef = useRef(settingsSection);
  const selectedCardRef = useRef<SelectedCard | null>(selectedCard);
  const cardDraftRef = useRef(cardDraft);
  const cardTitleContextRef = useRef<CardSettingsTitleContext | undefined>(
    undefined,
  );
  const wallpaperRequestIdRef = useRef(0);
  const wallpaperSignatureRef = useRef<DesktopWallpaperSignature | null>(null);

  const activeWidget = widgetRegistry.widgets.find(
    (widget) => widget.id === widgetRegistry.activeWidgetId,
  );
  const activeSkin =
    skinThemes.find((theme) => theme.id === activeSkinId) ?? skinThemes[0];
  const termWeekInfo = useMemo(
    () =>
      getTermWeekInfo(
        settings.term.startDate,
        settings.term.endDate,
        getBeijingToday(),
      ),
    [settings.term.endDate, settings.term.startDate],
  );
  const computedWeek = useMemo(
    () =>
      clampWeek(termWeekInfo.baseWeek + weekOffset, termWeekInfo.totalWeeks),
    [termWeekInfo.baseWeek, termWeekInfo.totalWeeks, weekOffset],
  );
  const visibleDays = useMemo(
    () =>
      getVisibleDays(
        settings.workdayMode,
        settings.term.startDate,
        computedWeek,
      ),
    [computedWeek, settings.term.startDate, settings.workdayMode],
  );
  const activeWeekday = useMemo(
    () => getActiveWeekdayForVisibleDays(visibleDays, getBeijingToday()),
    [visibleDays],
  );

  const visibleSchedule = useMemo(
    () =>
      applyVisibleCourseRulesToSchedule(
        {
          ...schedule,
          weekNumber: computedWeek,
          activeWeekday,
          days: visibleDays,
          rows: schedule.rows.map((row) => ensureRowCourses(row)),
        },
        computedWeek,
      ),
    [activeWeekday, computedWeek, schedule, visibleDays],
  );
  const normalizedAppearance = useMemo(
    () => normalizeAppearanceSettings(settings.appearance),
    [settings.appearance],
  );
  const widgetStyle = useMemo(
    () => buildWidgetStyle(settings.appearance, visibleSchedule, wallpaperInfo),
    [settings.appearance, visibleSchedule, wallpaperInfo],
  );

  useEffect(() => {
    void invoke<WindowModeState>("get_window_mode").then((state) => {
      modeRef.current = state.mode;
      setMode(state.mode);
    });
    void invoke<{ activeSkinId: string }>("load_widget_settings").then(
      (loadedSettings) => {
        setActiveSkinId(loadedSettings.activeSkinId);
      },
    );
    void invoke<WidgetRegistryState>("load_widget_registry").then(
      (registry) => {
        setWidgetRegistry(registry);
        const widget = registry.widgets.find(
          (item) => item.id === registry.activeWidgetId,
        );
        if (widget) {
          modeRef.current = widget.mode;
          setMode(widget.mode);
          setActiveSkinId(widget.skinId);
        }
      },
    );
  }, []);

  const refreshWallpaperInfo = useCallback(async () => {
    const requestId = ++wallpaperRequestIdRef.current;
    if (normalizedAppearance.backgroundMode !== "blur") {
      wallpaperSignatureRef.current = null;
      setWallpaperInfo(null);
      return;
    }

    try {
      const info = await invoke<DesktopWallpaperInfo>("get_desktop_wallpaper");
      if (requestId === wallpaperRequestIdRef.current) {
        wallpaperSignatureRef.current = info.signature;
        setWallpaperInfo(info);
        setWallpaperVersion((current) => current + 1);
      }
    } catch {
      if (requestId === wallpaperRequestIdRef.current) {
        wallpaperSignatureRef.current = null;
        setWallpaperInfo(null);
      }
    }
  }, [normalizedAppearance.backgroundMode]);

  useEffect(() => {
    if (normalizedAppearance.backgroundMode !== "blur") {
      wallpaperSignatureRef.current = null;
      setWallpaperInfo(null);
      return;
    }

    void refreshWallpaperInfo();

    const refreshTimer = window.setTimeout(() => {
      void refreshWallpaperInfo();
    }, 120);

    return () => window.clearTimeout(refreshTimer);
  }, [normalizedAppearance.backgroundMode, refreshWallpaperInfo]);

  useEffect(() => {
    const unlistenPromise = listen(DESKTOP_WALLPAPER_CHANGED_EVENT, () => {
      void refreshWallpaperInfo();
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refreshWallpaperInfo]);

  useEffect(() => {
    if (normalizedAppearance.backgroundMode !== "blur") {
      return;
    }

    const checkWallpaperSignature = async () => {
      try {
        const nextSignature = await invoke<DesktopWallpaperSignature>(
          "get_desktop_wallpaper_signature",
        );
        const previousSignature = wallpaperSignatureRef.current;
        if (!previousSignature) {
          wallpaperSignatureRef.current = nextSignature;
          return;
        }

        if (!isSameWallpaperSignature(previousSignature, nextSignature)) {
          wallpaperSignatureRef.current = nextSignature;
          void refreshWallpaperInfo();
        }
      } catch {}
    };

    const signatureTimer = window.setInterval(() => {
      void checkWallpaperSignature();
    }, WALLPAPER_SIGNATURE_CHECK_MS);

    return () => window.clearInterval(signatureTimer);
  }, [normalizedAppearance.backgroundMode, refreshWallpaperInfo]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  useEffect(() => {
    if (suppressNextSchedulePersistenceRef.current) {
      suppressNextSchedulePersistenceRef.current = false;
      return;
    }
    if (!schedulePersistenceReady) {
      return;
    }

    void (async () => {
      try {
        await invoke("save_current_schedule", { schedule });
        const nextSyncStatus = await invoke<LocalSyncStatus>(
          "load_local_sync_status",
        );
        localSyncStatusRef.current = nextSyncStatus;
        setLocalSyncStatus(nextSyncStatus);
      } catch {}
    })();
  }, [schedule, schedulePersistenceReady]);

  useEffect(() => {
    accountStateRef.current = accountState;
  }, [accountState]);

  useEffect(() => {
    localSyncStatusRef.current = localSyncStatus;
  }, [localSyncStatus]);

  useEffect(() => {
    manualSyncRunningRef.current = manualSyncRunning;
  }, [manualSyncRunning]);

  useEffect(() => {
    return () => {
      if (syncTipTimerRef.current) {
        window.clearTimeout(syncTipTimerRef.current);
      }
    };
  }, []);

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

  const refreshAccountAndSchedule = useCallback(async (forceRender = false) => {
    setSchedulePersistenceReady(false);
    const nextAccountState = await invoke<LocalAccountState>(
      "load_local_account_state",
    );
    const storedSchedule = await invoke<StoredSchedulePayload<Schedule>>(
      "load_current_schedule",
    );
    accountStateRef.current = nextAccountState;
    setAccountState(nextAccountState);

    if (storedSchedule.schedule) {
      const nextSettings = deriveSettingsFromSyncedSchedule(
        settingsRef.current,
        storedSchedule.schedule,
      );
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      scheduleRef.current = storedSchedule.schedule;
      suppressNextSchedulePersistenceRef.current = true;
      setSchedule(storedSchedule.schedule);
      if (forceRender) {
        setScheduleRenderVersion((current) => current + 1);
      }
      const nextSyncStatus = await invoke<LocalSyncStatus>(
        "load_local_sync_status",
      );
      localSyncStatusRef.current = nextSyncStatus;
      setLocalSyncStatus(nextSyncStatus);
      setSchedulePersistenceReady(true);
      return;
    }

    const fallbackSchedule = scheduleRef.current ?? mockSchedule;
    scheduleRef.current = fallbackSchedule;
    setSchedule(fallbackSchedule);
    if (forceRender) {
      setScheduleRenderVersion((current) => current + 1);
    }
    await invoke("save_current_schedule", { schedule: fallbackSchedule });
    const nextSyncStatus = await invoke<LocalSyncStatus>(
      "load_local_sync_status",
    );
    localSyncStatusRef.current = nextSyncStatus;
    setLocalSyncStatus(nextSyncStatus);
    setSchedulePersistenceReady(true);
  }, []);

  useEffect(() => {
    void refreshAccountAndSchedule();
  }, [refreshAccountAndSchedule]);

  const switchMode = useCallback(async () => {
    const command =
      modeRef.current === "attached"
        ? "switch_to_detached"
        : "switch_to_attached";
    const state = await invoke<WindowModeState>(command);
    modeRef.current = state.mode;
    menuOpenRef.current = false;
    setMode(state.mode);
    setWidgetRegistry((current) => updateActiveWidgetMode(current, state.mode));
    setMenuOpen(false);
    setHovered(false);

    if (
      state.mode === "detached" &&
      settingsRef.current.appearance.backgroundMode === "blur"
    ) {
      const nextSettings = {
        ...settingsRef.current,
        appearance: {
          ...settingsRef.current.appearance,
          backgroundMode: "solid" as const,
        },
      };
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
    }

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

    await emitTo<FloatingToolbarStatePayload>(
      FLOATING_TOOLBAR_WINDOW_LABEL,
      FLOATING_TOOLBAR_STATE_EVENT,
      {
        weekNumber: computedWeek,
        menuOpen: menuOpenRef.current,
        toolbarLayoutMode: toolbarLayoutModeRef.current,
        backgroundMode: normalizedAppearance.backgroundMode,
        canPreviousWeek: computedWeek > 1,
        canNextWeek: computedWeek < termWeekInfo.totalWeeks,
        authLabel: getAuthToolbarLabel(accountStateRef.current),
        authTitle: getAuthToolbarTitle(accountStateRef.current),
        loggedIn: accountStateRef.current.loggedIn,
        syncButtonState: getToolbarSyncButtonState(
          accountStateRef.current,
          localSyncStatusRef.current,
          manualSyncRunningRef.current,
        ),
        syncTitle: getToolbarSyncTitle(
          accountStateRef.current,
          localSyncStatusRef.current,
          manualSyncRunningRef.current,
        ),
      },
    );
  }, [
    computedWeek,
    normalizedAppearance.backgroundMode,
    termWeekInfo.totalWeeks,
  ]);

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
      await emitTo<SettingsWindowStatePayload>(
        SETTINGS_WINDOW_LABEL,
        SETTINGS_WINDOW_STATE_EVENT,
        {
          settings: currentSettings,
          activeSection: currentSection,
          periods: schedulePeriodsForSettings(scheduleRef.current),
          windowMode: modeRef.current,
        },
      );
    } catch {}
  }, []);

  const openAuth = useCallback(async () => {
    menuOpenRef.current = false;
    setMenuOpen(false);

    try {
      await invoke("toggle_auth_window");
    } catch {}
  }, []);

  const showSyncFailureTip = useCallback((message: string) => {
    if (syncTipTimerRef.current) {
      window.clearTimeout(syncTipTimerRef.current);
    }

    setSyncTip({
      title: "同步失败",
      message,
    });
    syncTipTimerRef.current = window.setTimeout(() => {
      setSyncTip(null);
      syncTipTimerRef.current = null;
    }, 2800);
  }, []);

  const applyLocalSyncStatus = useCallback((nextStatus: LocalSyncStatus) => {
    localSyncStatusRef.current = nextStatus;
    setLocalSyncStatus(nextStatus);
  }, []);

  const loadLocalSyncStatus = useCallback(async () => {
    const nextStatus = await invoke<LocalSyncStatus>("load_local_sync_status");
    applyLocalSyncStatus(nextStatus);
    return nextStatus;
  }, [applyLocalSyncStatus]);

  const runManualSync = useCallback(async () => {
    if (!accountStateRef.current.loggedIn || manualSyncRunningRef.current) {
      return;
    }

    manualSyncRunningRef.current = true;
    setManualSyncRunning(true);

    try {
      const nextStatus = await invoke<LocalSyncStatus>(
        "manual_sync_current_user",
      );
      applyLocalSyncStatus(nextStatus);
      await refreshAccountAndSchedule();
      if (nextStatus.lastSyncError) {
        showSyncFailureTip(nextStatus.lastSyncError);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showSyncFailureTip(message);
      try {
        await loadLocalSyncStatus();
      } catch {}
    } finally {
      manualSyncRunningRef.current = false;
      setManualSyncRunning(false);
    }
  }, [
    applyLocalSyncStatus,
    loadLocalSyncStatus,
    refreshAccountAndSchedule,
    showSyncFailureTip,
  ]);

  const persistCurrentSchedule = useCallback(
    async (sourceAction?: string) => {
      await invoke(
        "save_current_schedule",
        sourceAction
          ? { schedule: scheduleRef.current, sourceAction }
          : { schedule: scheduleRef.current },
      );
      await loadLocalSyncStatus();
    },
    [loadLocalSyncStatus],
  );

  const closeWidgetMenu = useCallback(async () => {
    menuClosedAtRef.current = Date.now();
    menuOpenRef.current = false;
    setMenuOpen(false);
    await invoke("clear_proxy_menu_open");
    await hideWindowByLabel(WIDGET_MENU_WINDOW_LABEL);
  }, []);

  const openWidgetMenu = useCallback(
    async (
      sourceWindowLabel?: string,
      anchor?: { x: number; y: number; width: number; height: number },
    ) => {
      if (menuOpenRef.current) {
        await closeWidgetMenu();
        return;
      }

      if (Date.now() - menuClosedAtRef.current < 300) {
        return;
      }

      try {
        await invoke("open_widget_menu_window");
        await positionWidgetMenuWindow(sourceWindowLabel, anchor);
        await emitWidgetMenuState(modeRef.current);
        menuOpenRef.current = true;
        setMenuOpen(true);
      } catch {}
    },
    [closeWidgetMenu],
  );

  const toggleToolbarLayoutMode = useCallback(async () => {
    const nextMode: ToolbarLayoutMode =
      toolbarLayoutModeRef.current === "normal" ? "minimalist" : "normal";
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
    if (cardSettingsHasPendingSaveRef.current) {
      try {
        await persistCurrentSchedule("desktop.courseCard.close");
      } catch {}
      cardSettingsHasPendingSaveRef.current = false;
    }
    cardSettingsWindowOpenRef.current = false;
    activeCardSettingsWindowLabelRef.current = null;
    selectedCardRef.current = null;
    cardTitleContextRef.current = undefined;
    setSelectedCard(null);
    setActiveCellId(null);
    await invoke("clear_proxy_active_card");
    await hideWindowByLabel(CARD_SETTINGS_WINDOW_LABEL);
    await hideWindowByLabel(PERIOD_CARD_SETTINGS_WINDOW_LABEL);
  }, [persistCurrentSchedule]);

  const openCardSettings = useCallback(
    async (card: SelectedCard) => {
      if (
        cardSettingsWindowOpenRef.current &&
        selectedCardRef.current &&
        isSameSelectedCard(selectedCardRef.current, card)
      ) {
        await closeCardSettings();
        return;
      }

      const currentSchedule = {
        ...scheduleRef.current,
        rows: scheduleRef.current.rows.map((row) => ensureRowCourses(row)),
      };
      scheduleRef.current = currentSchedule;
      setSchedule(currentSchedule);
      const draft = createDraftForCard(
        currentSchedule,
        card,
        settingsRef.current.term,
      );
      const titleContext = createCardSettingsTitleContext(
        currentSchedule,
        card,
        visibleDays,
      );
      const course =
        card.type === "course"
          ? findCourse(currentSchedule, card.courseId)
          : undefined;
      const temporaryChanges =
        course?.temporaryChanges?.map(toTemporaryChangeDraft) ?? [];
      const targetWindowLabel = getCardSettingsWindowLabel(card);
      selectedCardRef.current = card;
      cardTitleContextRef.current = titleContext;
      cardDraftRef.current = draft;
      setSelectedCard(card);
      setCardDraft(draft);
      menuOpenRef.current = false;
      setMenuOpen(false);

      try {
        await hideWindowByLabel(getOtherCardSettingsWindowLabel(card));
        await invoke("open_card_settings_window", {
          title: buildInitialCardSettingsWindowTitle(card, titleContext, draft),
          windowLabel: targetWindowLabel,
        });
        cardSettingsWindowOpenRef.current = true;
        activeCardSettingsWindowLabelRef.current = targetWindowLabel;
        await emitTo<CardSettingsWindowStatePayload>(
          targetWindowLabel,
          CARD_SETTINGS_WINDOW_STATE_EVENT,
          {
            windowLabel: targetWindowLabel,
            selectedCard: card,
            draft,
            mergeState: getCourseCardMergeState(currentSchedule, card),
            term: settingsRef.current.term,
            titleContext,
            temporaryChanges,
            activeTemporaryChangeId: temporaryChanges[0]?.id ?? null,
          },
        );
      } catch {}
    },
    [closeCardSettings, visibleDays],
  );

  useEffect(() => {
    const unlistenUpdate = listen<SettingsWindowUpdatePayload>(
      SETTINGS_WINDOW_UPDATE_EVENT,
      (event) => {
        const nextSettings = event.payload.settings;
        const previousSettings = settingsRef.current;
        const previousAppearance = normalizeAppearanceSettings(
          previousSettings.appearance,
        );
        const nextAppearance = normalizeAppearanceSettings(
          nextSettings.appearance,
        );
        const previousAxisColor = buildAxisPalette(
          previousAppearance.axisColorMode,
          previousAppearance.backgroundColor,
        ).main;
        const nextAxisColor = buildAxisPalette(
          nextAppearance.axisColorMode,
          nextAppearance.backgroundColor,
        ).main;
        const shouldResizeWidget =
          nextSettings.periodCount !== previousSettings.periodCount;
        const shouldMaterializeScheduleGrid =
          nextSettings.workdayMode !== previousSettings.workdayMode;
        const shouldSyncPeriodTextColor = previousAxisColor !== nextAxisColor;
        const addedWeekdays = getAddedWorkdays(
          previousSettings.workdayMode,
          nextSettings.workdayMode,
        );
        const nextPeriods =
          event.payload.periods ??
          schedulePeriodsForSettings(scheduleRef.current);
        const shouldApplyPeriodConfig =
          JSON.stringify(nextPeriods) !==
          JSON.stringify(schedulePeriodsForSettings(scheduleRef.current));
        const effectiveNextSettings = shouldApplyPeriodConfig
          ? {
              ...nextSettings,
              periodCount: Math.max(1, Math.min(nextPeriods.length, 15)),
            }
          : nextSettings;

        settingsRef.current = effectiveNextSettings;
        if (
          event.payload.windowMode &&
          event.payload.windowMode !== modeRef.current
        ) {
          modeRef.current = event.payload.windowMode;
          setMode(event.payload.windowMode);
        }
        settingsSectionRef.current = normalizeSettingsSection(
          event.payload.activeSection,
        );
        setSettingsSection(
          normalizeSettingsSection(event.payload.activeSection),
        );
        setSettings(effectiveNextSettings);

        if (
          shouldMaterializeScheduleGrid ||
          shouldSyncPeriodTextColor ||
          shouldApplyPeriodConfig
        ) {
          let nextSchedule = shouldApplyPeriodConfig
            ? applyPeriodConfigToSchedule(scheduleRef.current, nextPeriods)
            : shouldMaterializeScheduleGrid
              ? {
                  ...scheduleRef.current,
                  rows: scheduleRef.current.rows.map((row) =>
                    ensureRowCourses(row, addedWeekdays),
                  ),
                }
              : scheduleRef.current;

          if (shouldSyncPeriodTextColor) {
            nextSchedule = applyAxisTextColorToPeriods(
              nextSchedule,
              nextAxisColor,
            );
          }

          scheduleRef.current = nextSchedule;
          suppressNextSchedulePersistenceRef.current =
            shouldApplyPeriodConfig ||
            suppressNextSchedulePersistenceRef.current;
          settingsWindowHasPendingScheduleSaveRef.current =
            shouldApplyPeriodConfig ||
            settingsWindowHasPendingScheduleSaveRef.current;
          setSchedule(nextSchedule);

          const currentCard = selectedCardRef.current;
          if (
            cardSettingsWindowOpenRef.current &&
            currentCard?.type === "period"
          ) {
            const nextDraft = createDraftForCard(
              nextSchedule,
              currentCard,
              effectiveNextSettings.term,
            );
            cardDraftRef.current = nextDraft;
            setCardDraft(nextDraft);
            void emitCardSettingsState(
              PERIOD_CARD_SETTINGS_WINDOW_LABEL,
              currentCard,
              nextDraft,
              nextSchedule,
              effectiveNextSettings.term,
              cardTitleContextRef.current,
            );
          }
        }

        if (!shouldResizeWidget && !shouldApplyPeriodConfig) {
          return;
        }

        const visibleScheduleForRows = shouldApplyPeriodConfig
          ? scheduleRef.current
          : {
              ...scheduleRef.current,
              rows: scheduleRef.current.rows.map((row) =>
                ensureRowCourses(row, addedWeekdays),
              ),
            };
        const scaleFactor = window.devicePixelRatio || 1;
        const measuredRowHeight = measureCurrentCourseRowHeight();
        if (measuredRowHeight) {
          courseRowHeightRef.current =
            courseRowHeightRef.current ?? measuredRowHeight;
        }
        const rowHeight = Math.round(
          (courseRowHeightRef.current ??
            measuredRowHeight ??
            DEFAULT_COURSE_ROW_HEIGHT) * scaleFactor,
        );
        void resizeDetachedWidgetToSchedule(visibleScheduleForRows, rowHeight);
      },
    );

    const unlistenRequest = listen<SettingsWindowStateRequestPayload>(
      SETTINGS_WINDOW_STATE_REQUEST_EVENT,
      (event) => {
        void emitTo<SettingsWindowStatePayload>(
          event.payload.windowLabel,
          SETTINGS_WINDOW_STATE_EVENT,
          {
            settings: settingsRef.current,
            activeSection: normalizeSettingsSection(settingsSectionRef.current),
            periods: schedulePeriodsForSettings(scheduleRef.current),
            windowMode: modeRef.current,
          },
        );
      },
    );

    const unlistenClose = listen(SETTINGS_WINDOW_CLOSE_EVENT, () => {
      if (settingsWindowHasPendingScheduleSaveRef.current) {
        void persistCurrentSchedule("desktop.periodSettings.close")
          .then(() => {
            settingsWindowHasPendingScheduleSaveRef.current = false;
            return loadLocalSyncStatus();
          })
          .catch(() => {});
      }
      settingsWindowOpenRef.current = false;
    });

    return () => {
      void unlistenUpdate.then((unlisten) => unlisten());
      void unlistenRequest.then((unlisten) => unlisten());
      void unlistenClose.then((unlisten) => unlisten());
    };
  }, [loadLocalSyncStatus, persistCurrentSchedule]);

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
    const unlistenPromise = listen<LocalAccountState>(
      AUTH_STATE_CHANGED_EVENT,
      () => {
        void refreshAccountAndSchedule();
      },
    );

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refreshAccountAndSchedule]);

  useEffect(() => {
    if (!accountState.loggedIn) {
      void invoke("stop_realtime_sync");
      return;
    }

    void invoke("start_realtime_sync");
    void invoke<LocalSyncStatus>("manual_sync_current_user")
      .then((nextStatus) => {
        applyLocalSyncStatus(nextStatus);
        return refreshAccountAndSchedule(true);
      })
      .catch(() => {
        void loadLocalSyncStatus();
      });
    return () => {
      void invoke("stop_realtime_sync");
    };
  }, [
    accountState.loggedIn,
    accountState.ownerUserId,
    applyLocalSyncStatus,
    loadLocalSyncStatus,
    refreshAccountAndSchedule,
  ]);

  useEffect(() => {
    const unlistenPromise = listen(SYNC_SERVER_CHANGE_EVENT, (event) => {
      console.info("sync websocket ui refresh", event.payload);
      void refreshAccountAndSchedule(true);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refreshAccountAndSchedule]);

  useEffect(() => {
    if (!settingsWindowOpenRef.current) {
      return;
    }

    void emitTo<SettingsWindowStatePayload>(
      SETTINGS_WINDOW_LABEL,
      SETTINGS_WINDOW_STATE_EVENT,
      {
        settings,
        activeSection: normalizeSettingsSection(settingsSection),
        periods: schedulePeriodsForSettings(scheduleRef.current),
        windowMode: mode,
      },
    );
  }, [settings, settingsSection, mode, scheduleRenderVersion]);

  useEffect(() => {
    void syncFloatingToolbarState();
  }, [
    accountState,
    computedWeek,
    localSyncStatus,
    manualSyncRunning,
    menuOpen,
    mode,
    syncFloatingToolbarState,
    toolbarLayoutMode,
  ]);

  useEffect(() => {
    const unlistenUpdate = listen<CardSettingsWindowUpdatePayload>(
      CARD_SETTINGS_WINDOW_UPDATE_EVENT,
      (event) => {
        cardSettingsHasPendingSaveRef.current = true;
        suppressNextSchedulePersistenceRef.current = true;
        setSelectedCard(event.payload.selectedCard);
        setCardDraft(event.payload.draft);
        setSchedule((current) => {
          const nextSchedule = applyCardDraft(
            current,
            event.payload.selectedCard,
            event.payload.draft,
            event.payload.temporaryChanges,
            event.payload.activeTemporaryChangeId,
          );
          scheduleRef.current = nextSchedule;
          void emitCardSettingsState(
            event.payload.windowLabel,
            event.payload.selectedCard,
            event.payload.draft,
            nextSchedule,
            settingsRef.current.term,
            cardTitleContextRef.current,
          );
          return nextSchedule;
        });
      },
    );

    const unlistenAction = listen<CardSettingsWindowActionPayload>(
      CARD_SETTINGS_WINDOW_ACTION_EVENT,
      (event) => {
        const shouldPersistImmediately =
          event.payload.action === "apply-schedule";
        const nextSchedule =
          event.payload.action === "apply-style" && event.payload.draft
            ? applyGlobalStyleToSchedule(
                scheduleRef.current,
                event.payload.draft,
              )
            : event.payload.action === "apply-schedule" && event.payload.draft
              ? applyGlobalScheduleToSchedule(
                  scheduleRef.current,
                  event.payload.draft,
                )
              : applyCourseCardAction(
                  scheduleRef.current,
                  event.payload.selectedCard,
                  event.payload.action,
                );
        const nextDraft = createDraftForCard(
          nextSchedule,
          event.payload.selectedCard,
          settingsRef.current.term,
        );
        scheduleRef.current = nextSchedule;
        cardDraftRef.current = nextDraft;
        setSchedule(nextSchedule);
        setCardDraft(nextDraft);
        suppressNextSchedulePersistenceRef.current = true;
        if (shouldPersistImmediately) {
          cardSettingsHasPendingSaveRef.current = false;
          void persistCurrentSchedule("desktop.courseCard.applySchedule").catch(
            () => {},
          );
        } else {
          cardSettingsHasPendingSaveRef.current = true;
        }
        void emitCardSettingsState(
          event.payload.windowLabel,
          event.payload.selectedCard,
          nextDraft,
          nextSchedule,
          settingsRef.current.term,
          cardTitleContextRef.current,
        );
      },
    );

    const unlistenRequest = listen<CardSettingsWindowStateRequestPayload>(
      CARD_SETTINGS_WINDOW_STATE_REQUEST_EVENT,
      (event) => {
        const currentCard = selectedCardRef.current;
        if (!currentCard) {
          return;
        }

        const currentCourse =
          currentCard.type === "course"
            ? findCourse(scheduleRef.current, currentCard.courseId)
            : undefined;

        void emitTo<CardSettingsWindowStatePayload>(
          event.payload.windowLabel,
          CARD_SETTINGS_WINDOW_STATE_EVENT,
          {
            windowLabel: event.payload.windowLabel,
            selectedCard: currentCard,
            draft: cardDraftRef.current,
            mergeState: getCourseCardMergeState(
              scheduleRef.current,
              currentCard,
            ),
            term: settingsRef.current.term,
            titleContext: cardTitleContextRef.current,
            temporaryChanges:
              currentCourse?.temporaryChanges?.map((change) => ({
                id: change.id,
                type: change.type,
                dates: change.dates,
                title: change.title ?? change.replaceTitle ?? "",
                subtitle: change.subtitle ?? change.replaceSecondary ?? "",
                color: change.color ?? change.replaceColor ?? "#4f46e5",
                style: change.style ?? {
                  fontFamily: "Microsoft YaHei",
                  fontSize: 14,
                  fontWeight: "medium",
                  displayMode: "auto",
                },
                createdAt: change.createdAt ?? new Date().toISOString(),
                updatedAt: change.updatedAt ?? new Date().toISOString(),
                replaceTitle: change.replaceTitle ?? "",
                replaceSecondary: change.replaceSecondary ?? "",
                replaceColor: change.replaceColor ?? change.color ?? "#4f46e5",
              })) ?? [],
            activeTemporaryChangeId:
              currentCourse?.temporaryChanges?.[0]?.id ?? null,
          },
        );
      },
    );

    const unlistenClose = listen<{ windowLabel?: string }>(
      CARD_SETTINGS_WINDOW_CLOSE_EVENT,
      (event) => {
        const closedWindowLabel = event.payload?.windowLabel;
        if (
          closedWindowLabel &&
          activeCardSettingsWindowLabelRef.current &&
          closedWindowLabel !== activeCardSettingsWindowLabelRef.current
        ) {
          return;
        }
        if (cardSettingsHasPendingSaveRef.current) {
          void persistCurrentSchedule("desktop.courseCard.close")
            .then(() => {
              cardSettingsHasPendingSaveRef.current = false;
            })
            .catch(() => {});
        }
        cardSettingsWindowOpenRef.current = false;
        activeCardSettingsWindowLabelRef.current = null;
        selectedCardRef.current = null;
        setSelectedCard(null);
      },
    );

    return () => {
      void unlistenUpdate.then((unlisten) => unlisten());
      void unlistenAction.then((unlisten) => unlisten());
      void unlistenRequest.then((unlisten) => unlisten());
      void unlistenClose.then((unlisten) => unlisten());
    };
  }, [persistCurrentSchedule]);

  useEffect(() => {
    const unlistenPromise = listen<DesktopInputEvent>(
      "desktop-input",
      (event) => {
        const payload = event.payload;

        if (payload.kind === "hover" || payload.kind === "move") {
          setHovered(true);
        }

        if (payload.kind === "leave") {
          setHovered(false);
        }

        // Click handling is intentionally split by mode:
        // detached uses normal DOM click/double-click events, attached uses the interaction proxy.
      },
    );

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [
    closeWidgetMenu,
    hideScheduleWidget,
    openAuth,
    openCardSettings,
    openSettings,
    openWidgetMenu,
    switchMode,
  ]);

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
          cssHeight:
            window.innerHeight || document.documentElement.clientHeight,
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
      if (modeRef.current !== "attached") {
        return;
      }

      handleProxyWidgetHit(
        hit,
        openFloatingToolbarWindow,
        openAuth,
        runManualSync,
        openWidgetMenu,
        toggleToolbarLayoutMode,
        stepWeek,
        openCardSettings,
        setActiveCellId,
        setMenuOpen,
      );
    };

    const unlistenPromise = listen<ProxyWidgetHit>(
      PROXY_TRIGGER_EVENT,
      (event) => {
        if (modeRef.current !== "attached") {
          return;
        }

        const hit = event.payload;
        handleProxyWidgetHit(
          hit,
          openFloatingToolbarWindow,
          openAuth,
          runManualSync,
          openWidgetMenu,
          toggleToolbarLayoutMode,
          stepWeek,
          openCardSettings,
          setActiveCellId,
          setMenuOpen,
        );
      },
    );

    return () => {
      if (window.__teacherScheduleProxyTrigger) {
        delete window.__teacherScheduleProxyTrigger;
      }
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [
    openAuth,
    openCardSettings,
    openFloatingToolbarWindow,
    openWidgetMenu,
    runManualSync,
    toggleToolbarLayoutMode,
  ]);

  useEffect(() => {
    const unlistenPromise = listen<WidgetMenuAction>(
      WIDGET_MENU_ACTION_EVENT,
      (event) => {
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
      },
    );

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [hideScheduleWidget, openSettings, switchMode]);

  useEffect(() => {
    const unlistenPromise = listen<FloatingToolbarActionPayload>(
      FLOATING_TOOLBAR_ACTION_EVENT,
      (event) => {
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

        if (action === "auth") {
          void openAuth();
          return;
        }

        if (action === "sync") {
          void runManualSync();
          return;
        }

        if (action === "menu") {
          void openWidgetMenu(sourceWindowLabel, anchor);
        }
      },
    );

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [openAuth, openWidgetMenu, runManualSync, toggleToolbarLayoutMode]);

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
      const info = getTermWeekInfo(
        settingsRef.current.term.startDate,
        settingsRef.current.term.endDate,
        getBeijingToday(),
      );
      const nextWeek = clampWeek(
        info.baseWeek + current + delta,
        info.totalWeeks,
      );
      const nextOffset = nextWeek - info.baseWeek;
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
        key={scheduleRenderVersion}
        schedule={visibleSchedule}
        widgetTitle={activeWidget?.title ?? visibleSchedule.teacherName}
        mode={mode}
        menuOpen={menuOpen}
        hovered={hovered}
        activeCellId={activeCellId}
        menuButtonRef={menuButtonRef}
        widgetStyle={widgetStyle}
        wallpaperVersion={wallpaperVersion}
        backgroundMode={normalizedAppearance.backgroundMode}
        periodColumnStyle={normalizedAppearance.periodColumnStyle}
        toolbarLayoutMode={toolbarLayoutMode}
        authLabel={getAuthToolbarLabel(accountState)}
        authTitle={getAuthToolbarTitle(accountState)}
        loggedIn={accountState.loggedIn}
        syncButtonState={getToolbarSyncButtonState(
          accountState,
          localSyncStatus,
          manualSyncRunning,
        )}
        syncTitle={getToolbarSyncTitle(
          accountState,
          localSyncStatus,
          manualSyncRunning,
        )}
        canPreviousWeek={computedWeek > 1}
        canNextWeek={computedWeek < termWeekInfo.totalWeeks}
        onPreviousWeek={() => void stepWeek(-1)}
        onNextWeek={() => void stepWeek(1)}
        onToggleFloatingToolbar={openFloatingToolbarWindow}
        onToggleLayoutMode={toggleToolbarLayoutMode}
        onOpenAuth={openAuth}
        onSync={() => void runManualSync()}
        onToggleMenu={openWidgetMenu}
        onCourseClick={onCourseClick}
        onCardEdit={openCardSettings}
        onDragStart={startWindowDrag}
        onResizeStart={startWindowResize}
      />
      {syncTip ? (
        <div className="sync-tip" role="status">
          <strong>{syncTip.title}</strong>
          <span>{syncTip.message}</span>
        </div>
      ) : null}
    </main>
  );
}

function getVisibleDays(
  mode: WorkdayMode,
  termStartDate: string,
  weekNumber: number,
): Schedule["days"] {
  const days = buildVisibleDaysForWeek(mode, termStartDate, weekNumber);
  if (days.length > 0) {
    return days;
  }

  if (mode === "mon-sun") {
    return allScheduleDays;
  }

  if (mode === "mon-sat") {
    return allScheduleDays.slice(0, 6);
  }

  return allScheduleDays.slice(0, 5);
}

function deriveSettingsFromSyncedSchedule(
  current: WidgetSettingsState,
  schedule: Schedule,
): WidgetSettingsState {
  const syncedMeta = (
    schedule as Schedule & {
      syncMeta?: {
        termStart?: string;
        termEnd?: string;
        visibleDays?: number;
      };
    }
  ).syncMeta;
  const rowCount = Math.max(
    1,
    Math.min(schedule.rows.length || current.periodCount, 15),
  );
  const visibleDayCount = Math.max(
    1,
    Math.min(syncedMeta?.visibleDays ?? schedule.days.length, 7),
  );
  const nextWorkdayMode: WorkdayMode =
    visibleDayCount >= 7
      ? "mon-sun"
      : visibleDayCount >= 6
        ? "mon-sat"
        : "mon-fri";

  return {
    ...current,
    workdayMode: nextWorkdayMode,
    periodCount: rowCount,
    term: {
      startDate: syncedMeta?.termStart ?? current.term.startDate,
      endDate: syncedMeta?.termEnd ?? current.term.endDate,
    },
  };
}

function buildVisibleDaysForWeek(
  mode: WorkdayMode,
  termStartDate: string,
  weekNumber: number,
): Schedule["days"] {
  const weekdays = getWorkdayWeekdays(mode);
  const weekStart = getVisibleWeekStartDate(termStartDate, weekNumber);
  return weekdays.map((weekday, index) => {
    const current = new Date(weekStart);
    current.setDate(weekStart.getDate() + index);
    return {
      id: weekday,
      label: allScheduleDays.find((day) => day.id === weekday)?.label ?? "",
      dateLabel: formatMonthDay(current),
      date: formatIsoDate(current),
    };
  });
}

function getActiveWeekdayForVisibleDays(
  days: Schedule["days"],
  today: Date,
): Weekday | undefined {
  const todayIso = formatIsoDate(today);
  return days.find((day) => day.date === todayIso)?.id;
}

function getWorkdayWeekdays(mode: WorkdayMode): Weekday[] {
  if (mode === "mon-sun") {
    return allScheduleDays.map((day) => day.id);
  }

  if (mode === "mon-sat") {
    return allScheduleDays.slice(0, 6).map((day) => day.id);
  }

  return allScheduleDays.slice(0, 5).map((day) => day.id);
}

function getVisibleWeekStartDate(
  termStartDate: string,
  weekNumber: number,
): Date {
  const start = parseIsoDateOnly(termStartDate);
  if (Number.isNaN(start.getTime())) {
    return getWeekStartForTerm(getBeijingToday());
  }

  const weekStart = getWeekStartForTerm(start);
  weekStart.setDate(weekStart.getDate() + (Math.max(1, weekNumber) - 1) * 7);
  return weekStart;
}

function formatMonthDay(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeSettingsSection(
  section: SettingsSection | string,
): SettingsSection {
  return section === "periods" || section === "term" || section === "appearance"
    ? section
    : "schedule";
}

function limitScheduleRows(
  scheduleRows: Schedule["rows"],
  periodCount: number,
): Schedule["rows"] {
  const count = Math.max(1, Math.min(periodCount, 15));
  const rows = scheduleRows.slice(0, count).map((row) => ensureRowCourses(row));

  while (rows.length < count) {
    const previous = rows[rows.length - 1];
    rows.push(createFallbackRow(rows.length + 1, previous));
  }

  return rows;
}

function applyPeriodCountToSchedule(
  schedule: Schedule,
  periodCount: number,
): Schedule {
  return {
    ...schedule,
    rows: limitScheduleRows(schedule.rows, periodCount),
  };
}

function schedulePeriodsForSettings(schedule: Schedule): PeriodConfigItem[] {
  return schedule.rows
    .map((row) => ({
      id: row.period.id,
      label: row.period.label,
      time: normalizePeriodTime(row.period.time),
    }))
    .sort(comparePeriodConfigItems);
}

function applyPeriodConfigToSchedule(
  schedule: Schedule,
  periods: PeriodConfigItem[],
): Schedule {
  const normalizedPeriods = normalizePeriodConfigItems(periods);
  const previousRows = new Map(
    schedule.rows.map((row) => [row.period.id, ensureRowCourses(row)]),
  );
  const nextRows = normalizedPeriods.map((period, index) => {
    const existing = previousRows.get(period.id);
    if (existing) {
      return ensureRowCourses({
        ...existing,
        id: period.id,
        period: {
          ...existing.period,
          id: period.id,
          label: period.label,
          time: period.time,
        },
      });
    }
    return createPeriodConfigRow(period, index + 1);
  });

  return {
    ...schedule,
    rows: nextRows,
  };
}

function normalizePeriodConfigItems(
  periods: PeriodConfigItem[],
): PeriodConfigItem[] {
  return periods
    .map((period, index) => {
      const order = periodOrder(period.id) ?? index + 1;
      return {
        id: period.id || `p${order}`,
        label: period.label.trim() || `第${order}节`,
        time: normalizePeriodTime(period.time),
      };
    })
    .sort(comparePeriodConfigItems);
}

function comparePeriodConfigItems(
  left: PeriodConfigItem,
  right: PeriodConfigItem,
): number {
  const leftStart = timeToMinutes(left.time.split("-")[0]);
  const rightStart = timeToMinutes(right.time.split("-")[0]);
  if (leftStart !== rightStart) {
    return leftStart - rightStart;
  }
  return (periodOrder(left.id) ?? 0) - (periodOrder(right.id) ?? 0);
}

function createPeriodConfigRow(
  period: PeriodConfigItem,
  order: number,
): ScheduleRow {
  return {
    id: period.id || `p${order}`,
    period: {
      id: period.id || `p${order}`,
      label: period.label || `第${order}节`,
      time: normalizePeriodTime(period.time),
    },
    courses: Object.fromEntries(
      allScheduleDays.map((day) => [
        day.id,
        createEmptyCourseCell(
          courseCardIdFor(day.id, period.id || `p${order}`),
        ),
      ]),
    ) as Record<Weekday, CourseCell>,
  };
}

function ensureScheduleCapacity(
  schedule: Schedule,
  periodCount: number,
  newlyVisibleWeekdays: Weekday[] = [],
): Schedule {
  const count = Math.max(1, Math.min(periodCount, 15));
  const rows = schedule.rows.map((row) =>
    ensureRowCourses(row, newlyVisibleWeekdays),
  );

  while (rows.length < count) {
    const previous = rows[rows.length - 1];
    rows.push(createFallbackRow(rows.length + 1, previous));
  }

  return {
    ...schedule,
    rows,
  };
}

function applyVisibleCourseRulesToSchedule(
  schedule: Schedule,
  weekNumber: number,
): Schedule {
  const visibleDateByWeekday = new Map<Weekday, string>();
  for (const day of schedule.days) {
    if (day.date) {
      visibleDateByWeekday.set(day.id, day.date);
    }
  }

  return {
    ...schedule,
    rows: schedule.rows.map((row) => {
      const rowWithCourses = ensureRowCourses(row);
      const visibleCourses = Object.fromEntries(
        Object.entries(rowWithCourses.courses).map(([weekday, course]) => [
          weekday,
          applyVisibleCourseForDate(
            course,
            visibleDateByWeekday.get(weekday as Weekday),
            weekNumber,
          ),
        ]),
      ) as Record<Weekday, CourseCell>;

      return {
        ...rowWithCourses,
        courses: atomizeTemporaryMergedCoursesForRender(
          visibleCourses,
          schedule.days.map((day) => day.id),
        ),
      };
    }),
  };
}

function atomizeTemporaryMergedCoursesForRender(
  courses: Record<Weekday, CourseCell>,
  weekdays: Weekday[],
): Record<Weekday, CourseCell> {
  const nextCourses = { ...courses };
  for (const weekday of weekdays) {
    const course = nextCourses[weekday];
    if (!course) {
      continue;
    }

    if (course.mergedInto && course.renderBadge === "temporary") {
      const anchorLocation = weekdays.find(
        (item) => nextCourses[item]?.id === course.mergedInto,
      );
      if (anchorLocation) {
        atomizeRenderMergeGroup(nextCourses, weekdays, anchorLocation);
      }
      nextCourses[weekday] = { ...course, colSpan: 1, mergedInto: undefined };
      continue;
    }

    if (
      !course.mergedInto &&
      (course.colSpan ?? 1) > 1 &&
      course.renderBadge === "temporary"
    ) {
      atomizeRenderMergeGroup(nextCourses, weekdays, weekday);
    }
  }

  return nextCourses;
}

function atomizeRenderMergeGroup(
  courses: Record<Weekday, CourseCell>,
  weekdays: Weekday[],
  anchorWeekday: Weekday,
): void {
  const anchor = courses[anchorWeekday];
  if (!anchor) {
    return;
  }

  const span = anchor.colSpan ?? 1;
  const startIndex = weekdays.indexOf(anchorWeekday);
  courses[anchorWeekday] = { ...anchor, colSpan: 1, mergedInto: undefined };
  for (const coveredWeekday of weekdays.slice(
    startIndex + 1,
    startIndex + span,
  )) {
    const coveredCourse = courses[coveredWeekday];
    if (coveredCourse?.mergedInto === anchor.id) {
      courses[coveredWeekday] = {
        ...coveredCourse,
        colSpan: 1,
        mergedInto: undefined,
      };
    }
  }
}

function ensureRowCourses(
  row: ScheduleRow,
  newlyVisibleWeekdays: Weekday[] = [],
): ScheduleRow {
  const newWeekdaySet = new Set(newlyVisibleWeekdays);
  return {
    ...row,
    courses: Object.fromEntries(
      allScheduleDays.map((day) => {
        const course = row.courses[day.id];

        if (newWeekdaySet.has(day.id)) {
          return [
            day.id,
            createEmptyCourseCell(
              course?.id ?? courseCardIdFor(day.id, row.id),
            ),
          ];
        }

        if (!course) {
          return [
            day.id,
            createEmptyCourseCell(courseCardIdFor(day.id, row.id)),
          ];
        }

        return [day.id, course];
      }),
    ) as Record<Weekday, CourseCell>,
  };
}

function getAddedWorkdays(
  previousMode: WorkdayMode,
  nextMode: WorkdayMode,
): Weekday[] {
  const previous = new Set(getWorkdayWeekdays(previousMode));
  return getWorkdayWeekdays(nextMode).filter(
    (weekday) => !previous.has(weekday),
  );
}

function applyVisibleCourseForDate(
  course: CourseCell,
  date: string | undefined,
  weekNumber: number,
): CourseCell {
  const temporaryCourse = applyTemporaryChangeToCourse(course, date);
  if (temporaryCourse.renderBadge === "temporary") {
    return { ...temporaryCourse, hidden: false };
  }

  if (!isCourseConfigRenderable(course, date, weekNumber)) {
    return { ...course, hidden: true, renderBadge: undefined };
  }

  return {
    ...course,
    hidden: false,
    renderBadge: getWeekPatternRenderBadge(course),
  };
}

function getWeekPatternRenderBadge(
  course: CourseCell,
): CourseCell["renderBadge"] {
  if (course.scheduleRule?.weekPattern === "odd") {
    return "odd";
  }

  if (course.scheduleRule?.weekPattern === "even") {
    return "even";
  }

  return undefined;
}

function isCourseScheduledForDate(
  course: CourseCell,
  date: string | undefined,
  weekNumber: number,
): boolean {
  const rule = course.scheduleRule;
  if (!date || !rule) {
    return true;
  }

  if (rule.weekPattern === "odd" && weekNumber % 2 === 0) {
    return false;
  }

  if (rule.weekPattern === "even" && weekNumber % 2 !== 0) {
    return false;
  }

  if (!rule.applyWholeTerm) {
    if (rule.startDate && compareIsoDate(date, rule.startDate) < 0) {
      return false;
    }

    if (rule.endDate && compareIsoDate(date, rule.endDate) > 0) {
      return false;
    }
  }

  return true;
}

function isCourseConfigRenderable(
  course: CourseCell,
  date: string | undefined,
  weekNumber: number,
): boolean {
  return (
    course.title.trim().length > 0 &&
    isCourseScheduledForDate(course, date, weekNumber)
  );
}

function compareIsoDate(left: string, right: string): number {
  return left.localeCompare(right);
}

function applyTemporaryChangeToCourse(
  course: CourseCell,
  date: string | undefined,
): CourseCell {
  if (!date || !course.temporaryChanges?.length) {
    return course;
  }

  const change = [...(course.temporaryChanges ?? [])]
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? "");
      const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? "");
      return rightTime - leftTime;
    })
    .find((item) => item.dates.includes(date));
  if (!change) {
    return course;
  }

  if (change.type === "cancel") {
    const baseColor =
      change.color ??
      course.style?.baseColor ??
      course.style?.backgroundColor ??
      "#f8fafc";
    const computedPalette = computeCoursePalette(baseColor);
    return {
      ...course,
      title: change.title || "无课",
      room: change.subtitle ?? "",
      renderBadge: "temporary",
      style: {
        ...course.style,
        ...(change.style ?? {}),
        baseColor,
        backgroundColor: computedPalette.backgroundColor,
        color: computedPalette.color,
        iconColor: computedPalette.iconColor,
      },
    };
  }

  const baseColor =
    change.color ??
    change.replaceColor ??
    course.style?.baseColor ??
    course.style?.backgroundColor ??
    "#ffffff";
  const computedPalette = computeCoursePalette(baseColor);
  return {
    ...course,
    title: change.title ?? change.replaceTitle ?? course.title,
    room: change.subtitle ?? change.replaceSecondary ?? course.room,
    renderBadge: "temporary",
    style: {
      ...course.style,
      ...(change.style ?? {}),
      baseColor,
      backgroundColor: computedPalette.backgroundColor,
      color: computedPalette.color,
      iconColor: computedPalette.iconColor,
    },
  };
}

function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function createFallbackRow(order: number, previous?: ScheduleRow): ScheduleRow {
  const minutes = previous
    ? timeToMinutes(previous.period.time.split("-")[1])
    : 480 + (order - 1) * 55;
  const start = minutes;
  const end = minutes + 45;
  const startLabel = minutesToTime(start);
  const endLabel = minutesToTime(end);
  const rowId = `p${order}`;

  return {
    id: rowId,
    period: {
      id: rowId,
      label: `第${order}节`,
      time: `${startLabel}-${endLabel}`,
    },
    courses: Object.fromEntries(
      allScheduleDays.map((day) => [
        day.id,
        createEmptyCourseCell(`${rowId}-${day.id}`),
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
  const [hours, minutes] = normalizeTimeInput(time).split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return 0;
  }

  return hours * 60 + minutes;
}

function normalizePeriodTime(value: string): string {
  const [start, end] = value.split("-");
  return `${normalizeTimeInput(start)}-${normalizeTimeInput(end)}`;
}

function normalizeTimeInput(value: string | undefined): string {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec((value ?? "").trim());
  if (!match) {
    return "00:00";
  }
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function periodOrder(id: string): number | null {
  const match = /^p?(\d+)$/.exec(id.trim());
  if (!match) {
    return null;
  }
  return Number(match[1]);
}
function updateActiveWidgetMode(
  registry: WidgetRegistryState,
  mode: WindowMode,
): WidgetRegistryState {
  return {
    ...registry,
    widgets: registry.widgets.map((widget) =>
      widget.id === registry.activeWidgetId ? { ...widget, mode } : widget,
    ),
  };
}

async function emitWidgetMenuState(mode: WindowMode) {
  await emitTo<WidgetMenuStatePayload>(
    WIDGET_MENU_WINDOW_LABEL,
    WIDGET_MENU_STATE_EVENT,
    { mode },
  );
}

async function closeWindowByLabel(label: string) {
  const window = await WebviewWindow.getByLabel(label);
  if (!window) {
    return;
  }

  await window.hide();
}

async function positionFloatingToolbarWindow() {
  const toolbarWindow = await WebviewWindow.getByLabel(
    FLOATING_TOOLBAR_WINDOW_LABEL,
  );
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
  const hitboxes = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-auth-button], [data-menu-button], [data-header-toggle], [data-toolbar-action], [data-course-id], [data-period-id]",
    ),
  )
    .flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const courseId = element.dataset.courseId;
      const periodId = element.dataset.periodId;
      const toolbarAction = element.dataset.toolbarAction;
      const courseHitIds = parseCourseHitIds(
        element.dataset.courseHitIds,
        courseId,
      );
      const courseHitAxis =
        element.dataset.courseHitAxis === "vertical"
          ? "vertical"
          : "horizontal";
      const kind = element.dataset.authButton
        ? "auth-button"
        : element.dataset.menuButton
          ? "menu-button"
          : element.dataset.headerToggle
            ? "header-toggle"
            : toolbarAction === "layout-toggle" ||
                toolbarAction === "previous-week" ||
                toolbarAction === "next-week" ||
                toolbarAction === "sync"
              ? toolbarAction
              : courseId
                ? "course"
                : "period";

      if (kind === "course" && courseHitIds.length > 1) {
        const segmentWidth = rect.width / courseHitIds.length;
        const segmentHeight = rect.height / courseHitIds.length;
        return courseHitIds.map((id, index) => ({
          kind,
          id,
          left:
            courseHitAxis === "vertical"
              ? rect.left
              : rect.left + segmentWidth * index,
          top:
            courseHitAxis === "vertical"
              ? rect.top + segmentHeight * index
              : rect.top,
          right:
            courseHitAxis === "vertical"
              ? rect.right
              : index === courseHitIds.length - 1
                ? rect.right
                : rect.left + segmentWidth * (index + 1),
          bottom:
            courseHitAxis === "vertical"
              ? index === courseHitIds.length - 1
                ? rect.bottom
                : rect.top + segmentHeight * (index + 1)
              : rect.bottom,
        }));
      }

      return [
        {
          kind,
          id: courseId ?? periodId,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
      ];
    })
    .filter(
      (hitbox) => hitbox.right > hitbox.left && hitbox.bottom > hitbox.top,
    );

  return hitboxes;
}

function parseCourseHitIds(
  value: string | undefined,
  fallback: string | undefined,
): string[] {
  const ids =
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? [];
  if (ids.length > 0) {
    return ids;
  }

  return fallback ? [fallback] : [];
}

async function hideWindowByLabel(label: string) {
  const window = await WebviewWindow.getByLabel(label);
  if (!window) {
    return;
  }

  await window.hide();
}

function getCardSettingsWindowLabel(card: SelectedCard): string {
  return card.type === "period"
    ? PERIOD_CARD_SETTINGS_WINDOW_LABEL
    : CARD_SETTINGS_WINDOW_LABEL;
}

function getOtherCardSettingsWindowLabel(card: SelectedCard): string {
  return card.type === "period"
    ? CARD_SETTINGS_WINDOW_LABEL
    : PERIOD_CARD_SETTINGS_WINDOW_LABEL;
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
  openFloatingToolbarWindow: () => void,
  openAuth: () => Promise<void>,
  runManualSync: () => Promise<void>,
  openWidgetMenu: () => Promise<void>,
  toggleToolbarLayoutMode: () => Promise<void>,
  stepWeek: (delta: number) => Promise<void>,
  openCardSettings: (card: SelectedCard) => Promise<void>,
  setActiveCellId: (value: string | null) => void,
  setMenuOpen: (value: boolean) => void,
) {
  if (hit.kind === "menu-button") {
    void openWidgetMenu();
    return;
  }

  if (hit.kind === "auth-button") {
    void openAuth();
    return;
  }

  if (hit.kind === "sync") {
    void runManualSync();
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

  if (hit.kind === "previous-week") {
    void stepWeek(-1);
    return;
  }

  if (hit.kind === "next-week") {
    void stepWeek(1);
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
  const height = 168;
  const fallbackButton =
    document.querySelector<HTMLButtonElement>("[data-menu-button]");
  const rect = anchor
    ? { right: anchor.x + anchor.width, bottom: anchor.y + anchor.height }
    : fallbackButton?.getBoundingClientRect();
  if (!rect) {
    return;
  }

  const x = anchor
    ? Math.max(
        8,
        Math.round(rect.right - Math.round((width * scaleFactor) / 2)),
      )
    : Math.max(
        8,
        Math.round(
          (window.screenX + rect.right) * scaleFactor -
            Math.round((width * scaleFactor) / 2),
        ),
      );
  const y = anchor
    ? Math.max(8, Math.round(rect.bottom + 8))
    : Math.max(8, Math.round((window.screenY + rect.bottom) * scaleFactor + 8));

  await menuWindow.setPosition(new PhysicalPosition(x, y));
  await menuWindow.setSize(
    new PhysicalSize(
      Math.round(width * scaleFactor),
      Math.round(height * scaleFactor),
    ),
  );
}

function measureCurrentCourseRowHeight(): number | null {
  const row = document.querySelector<HTMLElement>(
    ".timetable-period-column .column-item",
  );
  if (!row) {
    return null;
  }

  return Math.round(row.getBoundingClientRect().height);
}

async function resizeDetachedWidgetToSchedule(
  schedule: Schedule,
  rowHeight: number,
) {
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

  await widgetWindow.setSize(
    new PhysicalSize(
      Math.round(innerWidth + chromeWidth),
      Math.round(innerHeight + chromeHeight),
    ),
  );
  await invoke("sync_active_widget_bounds");
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

function isSameWallpaperSignature(
  left: DesktopWallpaperSignature,
  right: DesktopWallpaperSignature,
): boolean {
  return (
    left.path === right.path &&
    left.fileSize === right.fileSize &&
    left.modifiedMs === right.modifiedMs &&
    left.wallpaperPosition === right.wallpaperPosition &&
    left.monitorLeft === right.monitorLeft &&
    left.monitorTop === right.monitorTop &&
    left.monitorWidth === right.monitorWidth &&
    left.monitorHeight === right.monitorHeight &&
    left.wallpaperLeft === right.wallpaperLeft &&
    left.wallpaperTop === right.wallpaperTop &&
    left.wallpaperWidth === right.wallpaperWidth &&
    left.wallpaperHeight === right.wallpaperHeight
  );
}

function buildWidgetStyle(
  appearance: WidgetSettingsState["appearance"],
  schedule: Schedule,
  wallpaperInfo: DesktopWallpaperInfo | null,
): CSSProperties {
  const normalizedAppearance = normalizeAppearanceSettings(appearance);
  const gridLineOpacity = String(normalizedAppearance.gridLineOpacity / 100);
  const blurIntensity =
    normalizedAppearance.backgroundMode === "blur"
      ? normalizedAppearance.blurIntensity
      : 0;
  const blurMix = clamp01(blurIntensity / 40);
  const backgroundFill = buildRgbaColor(
    normalizedAppearance.backgroundColor,
    normalizedAppearance.backgroundOpacity / 100,
  );
  const gridLineBorder = buildGridLineBorder(
    normalizedAppearance.gridLineType,
    normalizedAppearance.gridLineColor,
    normalizedAppearance.gridLineWidth,
    normalizedAppearance.gridLineOpacity,
  );
  const axisPalette = buildAxisPalette(
    normalizedAppearance.axisColorMode,
    normalizedAppearance.backgroundColor,
  );
  const deviceScale =
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return {
    "--column-gap": `${normalizedAppearance.columnGap}px`,
    "--outer-padding": "16px",
    "--content-padding": "14px",
    "--schedule-row-count": Math.max(1, schedule.rows.length),
    "--widget-background-mode": normalizedAppearance.backgroundMode,
    "--widget-background-color": normalizedAppearance.backgroundColor,
    "--widget-background-fill": backgroundFill,
    "--widget-background-opacity": String(
      normalizedAppearance.backgroundOpacity / 100,
    ),
    "--widget-blur-intensity": `${normalizedAppearance.blurIntensity}px`,
    "--widget-blur-filter": `blur(${normalizedAppearance.blurIntensity}px) saturate(1.08)`,
    "--row-divider": normalizedAppearance.gridLineColor,
    "--row-divider-rgb": hexToRgbParts(normalizedAppearance.gridLineColor),
    "--row-divider-opacity": gridLineOpacity,
    "--row-divider-style": normalizedAppearance.gridLineType,
    "--row-divider-thickness": `${normalizedAppearance.gridLineWidth}px`,
    "--row-divider-offset": `${normalizedAppearance.rowDividerHeight}px`,
    "--schedule-card-radius": `${normalizedAppearance.cardRadius}px`,
    "--schedule-card-shadow": mapCardShadowStrength(
      normalizedAppearance.cardShadowStrength,
    ),
    "--schedule-grid-line-style": normalizedAppearance.gridLineType,
    "--schedule-grid-line-color": normalizedAppearance.gridLineColor,
    "--schedule-grid-line-width": `${normalizedAppearance.gridLineWidth}px`,
    "--schedule-grid-line-opacity": gridLineOpacity,
    "--schedule-grid-line-border": gridLineBorder,
    "--axis-main-color": axisPalette.main,
    "--axis-muted-color": axisPalette.muted,
    "--axis-capsule-bg": axisPalette.capsuleBg,
    "--axis-capsule-border": axisPalette.capsuleBorder,
    "--axis-solid-bg": axisPalette.solidBg,
    "--axis-solid-border": axisPalette.solidBorder,
    "--widget-wallpaper-url": buildWallpaperCssImage(wallpaperInfo),
    "--widget-wallpaper-offset-x": wallpaperInfo
      ? `${Math.round((wallpaperInfo.wallpaperLeft - wallpaperInfo.windowLeft) / deviceScale)}px`
      : "0px",
    "--widget-wallpaper-offset-y": wallpaperInfo
      ? `${Math.round((wallpaperInfo.wallpaperTop - wallpaperInfo.windowTop) / deviceScale)}px`
      : "0px",
    "--widget-wallpaper-width": wallpaperInfo
      ? `${Math.max(1, Math.round(wallpaperInfo.wallpaperWidth / deviceScale))}px`
      : "100%",
    "--widget-wallpaper-height": wallpaperInfo
      ? `${Math.max(1, Math.round(wallpaperInfo.wallpaperHeight / deviceScale))}px`
      : "100%",
  } as CSSProperties;
}

function buildWallpaperCssImage(
  wallpaperInfo: DesktopWallpaperInfo | null,
): string {
  const source = buildWallpaperSourceUrl(wallpaperInfo);
  return source ? `url("${escapeCssUrl(source)}")` : "none";
}

function buildWallpaperSourceUrl(
  wallpaperInfo: DesktopWallpaperInfo | null,
): string | null {
  if (!wallpaperInfo) {
    return null;
  }

  const source = wallpaperInfo.path
    ? safeConvertFileSrc(wallpaperInfo.path)
    : wallpaperInfo.url;

  if (!source) {
    return null;
  }

  return appendWallpaperCacheKey(source, wallpaperInfo.signature);
}

function safeConvertFileSrc(path: string): string | null {
  try {
    return convertFileSrc(path);
  } catch {
    return null;
  }
}

function appendWallpaperCacheKey(
  source: string,
  signature: DesktopWallpaperSignature,
): string {
  const keyParts = [
    signature.path ?? "",
    signature.fileSize ?? "",
    signature.modifiedMs ?? "",
    signature.wallpaperPosition,
    signature.wallpaperLeft,
    signature.wallpaperTop,
    signature.wallpaperWidth,
    signature.wallpaperHeight,
  ];
  const version = encodeURIComponent(keyParts.join("|"));
  return `${source}${source.includes("?") ? "&" : "?"}v=${version}`;
}

function escapeCssUrl(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function buildGridLineBorder(
  type: "none" | "solid" | "dashed" | "dotted",
  color: string,
  width: number,
  opacity: number,
): string {
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

function buildAxisPalette(
  mode: AxisColorMode,
  backgroundColor: string,
): {
  main: string;
  muted: string;
  capsuleBg: string;
  capsuleBorder: string;
  solidBg: string;
  solidBorder: string;
} {
  const useLightText =
    mode === "light" ||
    (mode === "auto" && getHexLuminance(backgroundColor) < 138);

  if (useLightText) {
    return {
      main: "#F8FAFC",
      muted: "rgba(248, 250, 252, 0.66)",
      capsuleBg: "rgba(255, 255, 255, 0.08)",
      capsuleBorder: "rgba(255, 255, 255, 0.13)",
      solidBg: "rgba(255, 255, 255, 0.16)",
      solidBorder: "rgba(255, 255, 255, 0.22)",
    };
  }

  return {
    main: "#0F172A",
    muted: "rgba(15, 23, 42, 0.62)",
    capsuleBg: "rgba(15, 23, 42, 0.05)",
    capsuleBorder: "rgba(15, 23, 42, 0.09)",
    solidBg: "rgba(255, 255, 255, 0.62)",
    solidBorder: "rgba(15, 23, 42, 0.12)",
  };
}

function getHexLuminance(value: string): number {
  const rgb = hexToRgbParts(value)
    .split(" ")
    .map((channel) => Number.parseInt(channel, 10));

  if (rgb.length !== 3 || rgb.some((channel) => !Number.isFinite(channel))) {
    return 255;
  }

  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
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

function createCardSettingsTitleContext(
  schedule: Schedule,
  card: SelectedCard,
  visibleDays: Schedule["days"],
): CardSettingsTitleContext | undefined {
  if (card.type !== "course") {
    return undefined;
  }

  const location = findCourseLocation(schedule, card.courseId);
  if (!location) {
    return undefined;
  }

  const day =
    visibleDays.find((item) => item.id === location.weekday) ??
    allScheduleDays.find((item) => item.id === location.weekday);
  return {
    date: day?.date,
    dateLabel: day?.dateLabel,
    weekdayLabel: day?.label,
    periodLabel: location.row.period.label,
  };
}

function buildInitialCardSettingsWindowTitle(
  card: SelectedCard,
  titleContext: CardSettingsTitleContext | undefined,
  draft: CardDraft,
): string {
  if (card.type === "period") {
    return "课次卡片设置";
  }

  const courseTitle = draft.title.trim() || "未命名课程";
  const context = [
    titleContext?.weekdayLabel,
    titleContext?.periodLabel,
    courseTitle,
  ]
    .filter(Boolean)
    .join(" ");

  return ["课程设置", "｜", context || "未命名课程"].join(" ");
}

function createDraftForCard(
  schedule: Schedule,
  card: SelectedCard,
  term: WidgetSettingsState["term"],
): CardDraft {
  const base = {
    ...defaultCardDraft,
    startDate: term.startDate,
    endDate: term.endDate,
  };

  if (card.type === "course") {
    const course = findCourse(schedule, card.courseId);
    const courseBaseColor =
      course?.style?.baseColor ?? course?.style?.backgroundColor ?? "#FF3B30";
    const computedPalette = computeCoursePalette(courseBaseColor);
    const displayMode = course?.style?.displayMode ?? base.displayMode;
    return {
      ...base,
      title: course?.title ?? "",
      secondary: course?.room ?? "",
      backgroundColor: courseBaseColor,
      color: computedPalette.color,
      iconColor: computedPalette.iconColor,
      fontFamily: course?.style?.fontFamily ?? base.fontFamily,
      fontSize: course?.style?.fontSize ?? base.fontSize,
      fontWeight: course?.style?.fontWeight ?? base.fontWeight,
      displayMode,
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
      backgroundColor:
        period?.style?.baseColor ?? period?.style?.backgroundColor ?? "#ffffff",
      color: period?.style?.color ?? "#ffffff",
      iconColor: period?.style?.iconColor ?? period?.style?.color ?? "#ffffff",
      fontFamily: period?.style?.fontFamily ?? base.fontFamily,
      fontSize: clampPeriodFontSize(period?.style?.fontSize ?? 12),
      fontWeight: period?.style?.fontWeight ?? base.fontWeight,
      displayMode: "auto",
    };
  }
  return base;
}

function applyCardDraft(
  schedule: Schedule,
  selectedCard: SelectedCard | null,
  draft: CardDraft,
  temporaryChanges?: TemporaryChangeDraft[],
  activeTemporaryChangeId?: string | null,
): Schedule {
  if (!selectedCard) {
    return schedule;
  }

  const sourceSchedule =
    selectedCard.type === "course" && temporaryChanges !== undefined
      ? splitCourseCardForTemporaryChange(schedule, selectedCard.courseId)
      : schedule;
  const style =
    selectedCard.type === "period"
      ? toPeriodCardStyle(draft)
      : toCardStyle(draft);
  const targetCourseIds =
    selectedCard.type === "course" && temporaryChanges === undefined
      ? getCourseMergeGroupIds(sourceSchedule, selectedCard.courseId)
      : selectedCard.type === "course"
        ? new Set([selectedCard.courseId])
        : undefined;
  const rows = sourceSchedule.rows.map((row) =>
    applyDraftToRow(
      row,
      selectedCard,
      draft,
      style,
      temporaryChanges,
      targetCourseIds,
    ),
  );
  const nextSchedule = { ...sourceSchedule, rows };
  return selectedCard.type === "course"
    ? autoSplitInconsistentMergedCourse(nextSchedule, selectedCard.courseId)
    : nextSchedule;
}

function emitCardSettingsState(
  windowLabel: string,
  selectedCard: SelectedCard,
  draft: CardDraft,
  schedule: Schedule,
  term: WidgetSettingsState["term"],
  titleContext?: CardSettingsTitleContext,
) {
  const course =
    selectedCard.type === "course"
      ? findCourse(schedule, selectedCard.courseId)
      : undefined;
  const temporaryChanges =
    course?.temporaryChanges?.map(toTemporaryChangeDraft) ?? [];
  return emitTo<CardSettingsWindowStatePayload>(
    windowLabel,
    CARD_SETTINGS_WINDOW_STATE_EVENT,
    {
      windowLabel,
      selectedCard,
      draft,
      mergeState: getCourseCardMergeState(schedule, selectedCard),
      term,
      titleContext,
      temporaryChanges,
      activeTemporaryChangeId: temporaryChanges[0]?.id ?? null,
    },
  );
}

function getCourseCardMergeState(
  schedule: Schedule,
  selectedCard: SelectedCard,
): CourseCardMergeState {
  if (selectedCard.type !== "course") {
    return {
      canMergeUp: false,
      canMergeLeft: false,
      canMergeRight: false,
      canMergeDown: false,
      canSplit: false,
    };
  }

  const location = findCourseLocation(schedule, selectedCard.courseId);
  if (!location) {
    return {
      canMergeUp: false,
      canMergeLeft: false,
      canMergeRight: false,
      canMergeDown: false,
      canSplit: false,
      reason: "未找到课程卡片",
    };
  }

  const course = location.course;
  const canSplit =
    (course.colSpan ?? 1) > 1 ||
    (course.rowSpan ?? 1) > 1 ||
    Boolean(course.mergedInto);
  const horizontalGroup = getHorizontalMergeGroupLocation(location);
  const verticalGroup = getVerticalMergeGroupLocation(location);
  const leftAnchorLocation = horizontalGroup
    ? findLeftHorizontalGroupLocation(horizontalGroup)
    : null;
  const rightAnchorLocation = horizontalGroup
    ? findRightHorizontalGroupLocation(horizontalGroup)
    : null;
  const upAnchorLocation = verticalGroup
    ? findUpVerticalGroupLocation(verticalGroup)
    : null;
  const downAnchorLocation = verticalGroup
    ? findDownVerticalGroupLocation(verticalGroup)
    : null;
  const canMergeLeft = Boolean(
    horizontalGroup &&
    leftAnchorLocation &&
    canMergeCoursesRight(leftAnchorLocation.course, horizontalGroup.course),
  );
  const canMergeRight = Boolean(
    horizontalGroup &&
    rightAnchorLocation &&
    canMergeCoursesRight(horizontalGroup.course, rightAnchorLocation.course),
  );
  const canMergeUp = Boolean(
    verticalGroup &&
    upAnchorLocation &&
    canMergeCoursesDown(upAnchorLocation.course, verticalGroup.course),
  );
  const canMergeDown = Boolean(
    verticalGroup &&
    downAnchorLocation &&
    canMergeCoursesDown(verticalGroup.course, downAnchorLocation.course),
  );
  const reason =
    canMergeUp || canMergeLeft || canMergeRight || canMergeDown || canSplit
      ? undefined
      : "相邻卡片内容不一致";
  return {
    canMergeUp,
    canMergeLeft,
    canMergeRight,
    canMergeDown,
    canSplit,
    reason,
  };
}

function applyCourseCardAction(
  schedule: Schedule,
  selectedCard: SelectedCard,
  action: CardSettingsWindowActionPayload["action"],
): Schedule {
  if (selectedCard.type !== "course") {
    return schedule;
  }

  if (action === "merge-up") {
    return mergeCourseCardUp(schedule, selectedCard.courseId);
  }

  if (action === "merge-left") {
    return mergeCourseCardLeft(schedule, selectedCard.courseId);
  }

  if (action === "merge-right") {
    return mergeCourseCardRight(schedule, selectedCard.courseId);
  }

  if (action === "merge-down") {
    return mergeCourseCardDown(schedule, selectedCard.courseId);
  }

  if (action === "split") {
    return splitCourseCard(schedule, selectedCard.courseId);
  }

  return deleteCourseCard(schedule, selectedCard.courseId);
}

function applyGlobalStyleToSchedule(
  schedule: Schedule,
  draft: CardDraft,
): Schedule {
  const style = {
    fontFamily: draft.fontFamily,
    fontSize: draft.fontSize,
    fontWeight: draft.fontWeight,
    displayMode: draft.displayMode,
  } satisfies CardStyle;
  return {
    ...schedule,
    rows: schedule.rows.map((row) => ({
      ...row,
      courses: Object.fromEntries(
        Object.entries(row.courses).map(([weekday, course]) => [
          weekday,
          {
            ...course,
            style: {
              ...course.style,
              ...style,
            },
          },
        ]),
      ) as Record<Weekday, CourseCell>,
    })),
  };
}

function applyGlobalScheduleToSchedule(
  schedule: Schedule,
  draft: CardDraft,
): Schedule {
  return {
    ...schedule,
    rows: schedule.rows.map((row) => ({
      ...row,
      courses: Object.fromEntries(
        Object.entries(row.courses).map(([weekday, course]) => [
          weekday,
          {
            ...course,
            scheduleRule: {
              weekPattern: draft.weekPattern,
              applyWholeTerm: draft.applyWholeTerm,
              startDate: draft.applyWholeTerm ? undefined : draft.startDate,
              endDate: draft.applyWholeTerm ? undefined : draft.endDate,
            } satisfies CourseScheduleRule,
          },
        ]),
      ) as Record<Weekday, CourseCell>,
    })),
  };
}

function applyAxisTextColorToPeriods(
  schedule: Schedule,
  color: string,
): Schedule {
  return {
    ...schedule,
    rows: schedule.rows.map((row) => ({
      ...row,
      period: {
        ...row.period,
        style: {
          ...row.period.style,
          color,
          iconColor: color,
        },
      },
    })),
  };
}

function toPeriodCardStyle(draft: CardDraft): CardStyle {
  return {
    baseColor: draft.backgroundColor,
    backgroundColor: draft.backgroundColor,
    color: draft.color,
    iconColor: draft.color,
    fontFamily: draft.fontFamily,
    fontSize: clampPeriodFontSize(draft.fontSize),
    fontWeight: draft.fontWeight,
    displayMode: draft.displayMode,
  };
}

function clampPeriodFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 12;
  }

  return Math.max(8, Math.min(16, Math.round(value)));
}

function applyDraftToRow(
  row: ScheduleRow,
  selectedCard: SelectedCard,
  draft: CardDraft,
  style: CardStyle,
  temporaryChanges?: TemporaryChangeDraft[],
  targetCourseIds?: Set<string>,
): ScheduleRow {
  if (
    selectedCard.type === "period" &&
    selectedCard.periodId === row.period.id
  ) {
    return {
      ...row,
      period: {
        ...row.period,
        label: draft.title,
        time: draft.secondary,
        style,
      },
    };
  }

  if (selectedCard.type !== "course") {
    return row;
  }

  const courses = Object.fromEntries(
    Object.entries(row.courses).map(([weekday, course]) => [
      weekday,
      targetCourseIds?.has(course.id)
        ? {
            ...course,
            title: draft.title,
            room: draft.secondary,
            hidden: !isCourseDraftRenderable(draft),
            style,
            scheduleRule: {
              weekPattern: draft.weekPattern,
              applyWholeTerm: draft.applyWholeTerm,
              startDate: draft.applyWholeTerm ? undefined : draft.startDate,
              endDate: draft.applyWholeTerm ? undefined : draft.endDate,
            } satisfies CourseScheduleRule,
            temporaryChanges:
              temporaryChanges === undefined
                ? course.temporaryChanges
                : temporaryChanges.map(toCourseTemporaryChange),
          }
        : course,
    ]),
  ) as Record<Weekday, CourseCell>;

  return { ...row, courses };
}

function toCourseTemporaryChange(change: TemporaryChangeDraft) {
  return {
    id: change.id,
    type: change.type,
    dates: change.dates,
    title: change.title || undefined,
    subtitle: change.subtitle || undefined,
    color: change.color || change.replaceColor || undefined,
    style: change.style,
    createdAt: change.createdAt,
    updatedAt: change.updatedAt,
    replaceTitle: change.replaceTitle || undefined,
    replaceSecondary: change.replaceSecondary || undefined,
    replaceColor: change.replaceColor || undefined,
  } satisfies CourseTemporaryChange;
}

function isCourseDraftRenderable(draft: CardDraft): boolean {
  if (draft.title.trim().length === 0) {
    return false;
  }

  if (draft.applyWholeTerm) {
    return true;
  }

  return Boolean(
    draft.startDate &&
    draft.endDate &&
    compareIsoDate(draft.startDate, draft.endDate) <= 0,
  );
}

function toTemporaryChangeDraft(
  change: CourseTemporaryChange,
): TemporaryChangeDraft {
  const color = change.color ?? change.replaceColor ?? "#4f46e5";
  const style = change.style ?? {
    fontFamily: "Microsoft YaHei",
    fontSize: 14,
    fontWeight: "medium",
    displayMode: "auto",
  };
  return {
    id: change.id,
    type: change.type,
    dates: change.dates,
    title: change.title ?? change.replaceTitle ?? "",
    subtitle: change.subtitle ?? change.replaceSecondary ?? "",
    color,
    style,
    createdAt: change.createdAt ?? new Date().toISOString(),
    updatedAt: change.updatedAt ?? new Date().toISOString(),
    replaceTitle: change.replaceTitle ?? "",
    replaceSecondary: change.replaceSecondary ?? "",
    replaceColor: change.replaceColor ?? color,
  };
}

type CourseLocation = {
  rowIndex: number;
  weekday: Weekday;
  weekdayIndex: number;
  row: ScheduleRow;
  course: CourseCell;
  weekdays: Weekday[];
  rows: ScheduleRow[];
};

function findCourseLocation(
  schedule: Schedule,
  courseId: string,
): CourseLocation | null {
  const weekdays = allScheduleDays.map((day) => day.id);
  return findCourseLocationInRows(schedule.rows, weekdays, courseId);
}

function findCourseLocationInRows(
  rows: ScheduleRow[],
  weekdays: Weekday[],
  courseId: string,
): CourseLocation | null {
  for (const [rowIndex, row] of rows.entries()) {
    for (const [weekdayIndex, weekday] of weekdays.entries()) {
      const course = row.courses[weekday];
      if (course?.id === courseId) {
        return { rowIndex, weekday, weekdayIndex, row, course, weekdays, rows };
      }
    }
  }

  return null;
}

function findAnchorLocation(location: CourseLocation): CourseLocation | null {
  if (!location.course.mergedInto) {
    return location;
  }

  return findCourseLocationInRows(
    location.rows,
    location.weekdays,
    location.course.mergedInto,
  );
}

function getHorizontalMergeGroupLocation(
  location: CourseLocation,
): CourseLocation | null {
  const anchorLocation = findAnchorLocation(location);
  if (!anchorLocation || anchorLocation.rowIndex !== location.rowIndex) {
    return null;
  }

  if (
    (anchorLocation.course.rowSpan ?? 1) > 1 ||
    anchorLocation.course.mergeDirection === "vertical"
  ) {
    return null;
  }

  return anchorLocation;
}

function getVerticalMergeGroupLocation(
  location: CourseLocation,
): CourseLocation | null {
  const anchorLocation = findAnchorLocation(location);
  if (!anchorLocation || anchorLocation.weekday !== location.weekday) {
    return null;
  }

  if (
    (anchorLocation.course.colSpan ?? 1) > 1 ||
    anchorLocation.course.mergeDirection === "horizontal"
  ) {
    return null;
  }

  return anchorLocation;
}

function getCourseMergeGroupIds(
  schedule: Schedule,
  courseId: string,
): Set<string> {
  const location = findCourseLocation(schedule, courseId);
  if (!location) {
    return new Set([courseId]);
  }

  const horizontalGroup = getHorizontalMergeGroupLocation(location);
  if (
    horizontalGroup &&
    ((horizontalGroup.course.colSpan ?? 1) > 1 ||
      horizontalGroup.course.mergeDirection === "horizontal")
  ) {
    const span = horizontalGroup.course.colSpan ?? 1;
    return new Set(
      horizontalGroup.weekdays
        .slice(
          horizontalGroup.weekdayIndex,
          horizontalGroup.weekdayIndex + span,
        )
        .map((weekday) => horizontalGroup.row.courses[weekday]?.id)
        .filter((id): id is string => Boolean(id)),
    );
  }

  const verticalGroup = getVerticalMergeGroupLocation(location);
  if (
    verticalGroup &&
    ((verticalGroup.course.rowSpan ?? 1) > 1 ||
      verticalGroup.course.mergeDirection === "vertical")
  ) {
    const span = verticalGroup.course.rowSpan ?? 1;
    return new Set(
      verticalGroup.rows
        .slice(verticalGroup.rowIndex, verticalGroup.rowIndex + span)
        .map((row) => row.courses[verticalGroup.weekday]?.id)
        .filter((id): id is string => Boolean(id)),
    );
  }

  return new Set([courseId]);
}

function findRightHorizontalGroupLocation(
  location: CourseLocation,
): CourseLocation | null {
  const nextWeekday =
    location.weekdays[location.weekdayIndex + (location.course.colSpan ?? 1)];
  if (!nextWeekday) {
    return null;
  }

  const nextCourse = location.row.courses[nextWeekday];
  if (!nextCourse) {
    return null;
  }

  const nextLocation = findCourseLocationInRows(
    location.rows,
    location.weekdays,
    nextCourse.id,
  );
  const anchorLocation = nextLocation
    ? getHorizontalMergeGroupLocation(nextLocation)
    : null;
  return anchorLocation?.rowIndex === location.rowIndex &&
    anchorLocation.weekdayIndex ===
      location.weekdayIndex + (location.course.colSpan ?? 1)
    ? anchorLocation
    : null;
}

function findLeftHorizontalGroupLocation(
  location: CourseLocation,
): CourseLocation | null {
  if (location.weekdayIndex <= 0) {
    return null;
  }

  const previousWeekday = location.weekdays[location.weekdayIndex - 1];
  const previousCourse = location.row.courses[previousWeekday];
  if (!previousCourse) {
    return null;
  }

  const previousLocation = findCourseLocationInRows(
    location.rows,
    location.weekdays,
    previousCourse.id,
  );
  const anchorLocation = previousLocation
    ? getHorizontalMergeGroupLocation(previousLocation)
    : null;
  const anchorEndIndex = anchorLocation
    ? anchorLocation.weekdayIndex + (anchorLocation.course.colSpan ?? 1)
    : -1;
  return anchorLocation?.rowIndex === location.rowIndex &&
    anchorEndIndex === location.weekdayIndex
    ? anchorLocation
    : null;
}

function findDownVerticalGroupLocation(
  location: CourseLocation,
): CourseLocation | null {
  const nextRowIndex = location.rowIndex + (location.course.rowSpan ?? 1);
  const nextRow = location.rows[nextRowIndex];
  const nextCourse = nextRow?.courses[location.weekday];
  if (!nextCourse) {
    return null;
  }

  const nextLocation = findCourseLocationInRows(
    location.rows,
    location.weekdays,
    nextCourse.id,
  );
  const anchorLocation = nextLocation
    ? getVerticalMergeGroupLocation(nextLocation)
    : null;
  return anchorLocation?.weekday === location.weekday &&
    anchorLocation.rowIndex === nextRowIndex
    ? anchorLocation
    : null;
}

function findUpVerticalGroupLocation(
  location: CourseLocation,
): CourseLocation | null {
  if (location.rowIndex <= 0) {
    return null;
  }

  const previousRow = location.rows[location.rowIndex - 1];
  const previousCourse = previousRow?.courses[location.weekday];
  if (!previousCourse) {
    return null;
  }

  const previousLocation = findCourseLocationInRows(
    location.rows,
    location.weekdays,
    previousCourse.id,
  );
  const anchorLocation = previousLocation
    ? getVerticalMergeGroupLocation(previousLocation)
    : null;
  const anchorEndIndex = anchorLocation
    ? anchorLocation.rowIndex + (anchorLocation.course.rowSpan ?? 1)
    : -1;
  return anchorLocation?.weekday === location.weekday &&
    anchorEndIndex === location.rowIndex
    ? anchorLocation
    : null;
}

function canMergeBase(left: CourseCell, right: CourseCell): boolean {
  return (
    !left.hidden &&
    !right.hidden &&
    !left.mergedInto &&
    !right.mergedInto &&
    left.renderBadge !== "temporary" &&
    right.renderBadge !== "temporary" &&
    left.title === right.title &&
    (left.room ?? "") === (right.room ?? "") &&
    areScheduleRulesEqual(left.scheduleRule, right.scheduleRule)
  );
}

function canMergeCoursesRight(left: CourseCell, right: CourseCell): boolean {
  return (
    canMergeBase(left, right) &&
    (left.rowSpan ?? 1) === 1 &&
    (right.rowSpan ?? 1) === 1 &&
    (left.mergeDirection === undefined ||
      left.mergeDirection === "horizontal") &&
    (right.mergeDirection === undefined ||
      right.mergeDirection === "horizontal")
  );
}

function canMergeCoursesDown(top: CourseCell, bottom: CourseCell): boolean {
  return (
    canMergeBase(top, bottom) &&
    (top.colSpan ?? 1) === 1 &&
    (bottom.colSpan ?? 1) === 1 &&
    (top.mergeDirection === undefined || top.mergeDirection === "vertical") &&
    (bottom.mergeDirection === undefined ||
      bottom.mergeDirection === "vertical")
  );
}

function areScheduleRulesEqual(
  left?: CourseScheduleRule,
  right?: CourseScheduleRule,
): boolean {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.weekPattern === right.weekPattern &&
    left.applyWholeTerm === right.applyWholeTerm &&
    (left.startDate ?? "") === (right.startDate ?? "") &&
    (left.endDate ?? "") === (right.endDate ?? "")
  );
}

function mergeCourseCardRight(schedule: Schedule, courseId: string): Schedule {
  const location = findCourseLocation(schedule, courseId);
  const leftGroupLocation = location
    ? getHorizontalMergeGroupLocation(location)
    : null;
  const rightGroupLocation = leftGroupLocation
    ? findRightHorizontalGroupLocation(leftGroupLocation)
    : null;
  if (
    !leftGroupLocation ||
    !rightGroupLocation ||
    !canMergeCoursesRight(leftGroupLocation.course, rightGroupLocation.course)
  ) {
    return schedule;
  }

  return mergeHorizontalCourseGroups(
    schedule,
    leftGroupLocation,
    rightGroupLocation,
    location?.course.style,
  );
}

function mergeCourseCardLeft(schedule: Schedule, courseId: string): Schedule {
  const location = findCourseLocation(schedule, courseId);
  const rightGroupLocation = location
    ? getHorizontalMergeGroupLocation(location)
    : null;
  const leftGroupLocation = rightGroupLocation
    ? findLeftHorizontalGroupLocation(rightGroupLocation)
    : null;
  if (
    !leftGroupLocation ||
    !rightGroupLocation ||
    !canMergeCoursesRight(leftGroupLocation.course, rightGroupLocation.course)
  ) {
    return schedule;
  }

  return mergeHorizontalCourseGroups(
    schedule,
    leftGroupLocation,
    rightGroupLocation,
    location?.course.style,
  );
}

function mergeHorizontalCourseGroups(
  schedule: Schedule,
  leftLocation: CourseLocation,
  rightLocation: CourseLocation,
  sourceStyle?: CardStyle,
): Schedule {
  const leftSpan = leftLocation.course.colSpan ?? 1;
  const rightSpan = rightLocation.course.colSpan ?? 1;
  const mergedWeekdays = leftLocation.weekdays.slice(
    leftLocation.weekdayIndex,
    rightLocation.weekdayIndex + rightSpan,
  );
  const rows = schedule.rows.map((row, rowIndex) => {
    if (rowIndex !== leftLocation.rowIndex) {
      return row;
    }

    const courses = { ...row.courses };
    courses[leftLocation.weekday] = {
      ...leftLocation.course,
      colSpan: leftSpan + rightSpan,
      rowSpan: 1,
      mergedInto: undefined,
      mergeDirection: "horizontal",
      style: cloneCardStyle(sourceStyle),
    };

    for (const weekday of mergedWeekdays) {
      if (weekday === leftLocation.weekday) {
        continue;
      }

      const course = courses[weekday];
      if (!course) {
        continue;
      }

      courses[weekday] = {
        ...course,
        colSpan: 1,
        rowSpan: 1,
        mergedInto: leftLocation.course.id,
        mergeDirection: "horizontal",
        style: cloneCardStyle(sourceStyle),
      };
    }

    return {
      ...row,
      courses,
    };
  });

  return { ...schedule, rows };
}

function mergeCourseCardDown(schedule: Schedule, courseId: string): Schedule {
  const location = findCourseLocation(schedule, courseId);
  const topGroupLocation = location
    ? getVerticalMergeGroupLocation(location)
    : null;
  const bottomGroupLocation = topGroupLocation
    ? findDownVerticalGroupLocation(topGroupLocation)
    : null;
  if (
    !topGroupLocation ||
    !bottomGroupLocation ||
    !canMergeCoursesDown(topGroupLocation.course, bottomGroupLocation.course)
  ) {
    return schedule;
  }

  return mergeVerticalCourseGroups(
    schedule,
    topGroupLocation,
    bottomGroupLocation,
    location?.course.style,
  );
}

function mergeCourseCardUp(schedule: Schedule, courseId: string): Schedule {
  const location = findCourseLocation(schedule, courseId);
  const bottomGroupLocation = location
    ? getVerticalMergeGroupLocation(location)
    : null;
  const topGroupLocation = bottomGroupLocation
    ? findUpVerticalGroupLocation(bottomGroupLocation)
    : null;
  if (
    !topGroupLocation ||
    !bottomGroupLocation ||
    !canMergeCoursesDown(topGroupLocation.course, bottomGroupLocation.course)
  ) {
    return schedule;
  }

  return mergeVerticalCourseGroups(
    schedule,
    topGroupLocation,
    bottomGroupLocation,
    location?.course.style,
  );
}

function mergeVerticalCourseGroups(
  schedule: Schedule,
  topLocation: CourseLocation,
  bottomLocation: CourseLocation,
  sourceStyle?: CardStyle,
): Schedule {
  const topSpan = topLocation.course.rowSpan ?? 1;
  const bottomSpan = bottomLocation.course.rowSpan ?? 1;
  const mergedRowIndexes = Array.from(
    { length: topSpan + bottomSpan },
    (_, index) => topLocation.rowIndex + index,
  );
  const rows = schedule.rows.map((row, rowIndex) => {
    if (!mergedRowIndexes.includes(rowIndex)) {
      return row;
    }

    if (rowIndex === topLocation.rowIndex) {
      return {
        ...row,
        courses: {
          ...row.courses,
          [topLocation.weekday]: {
            ...topLocation.course,
            colSpan: 1,
            rowSpan: topSpan + bottomSpan,
            mergedInto: undefined,
            mergeDirection: "vertical",
            style: cloneCardStyle(sourceStyle),
          },
        },
      };
    }

    const target = row.courses[topLocation.weekday];
    if (!target) {
      return row;
    }

    return {
      ...row,
      courses: {
        ...row.courses,
        [topLocation.weekday]: {
          ...target,
          colSpan: 1,
          rowSpan: 1,
          mergedInto: topLocation.course.id,
          mergeDirection: "vertical",
          style: cloneCardStyle(sourceStyle),
        },
      },
    };
  });

  return { ...schedule, rows };
}

function cloneCardStyle(style?: CardStyle): CardStyle | undefined {
  return style ? { ...style } : undefined;
}

function splitCourseCard(schedule: Schedule, courseId: string): Schedule {
  return splitCourseCardPreservingMembers(schedule, courseId);
}

function splitCourseCardForTemporaryChange(
  schedule: Schedule,
  courseId: string,
): Schedule {
  const location = findCourseLocation(schedule, courseId);
  if (!location) {
    return schedule;
  }

  if (location.course.mergedInto) {
    return splitCourseCardPreservingMembers(
      schedule,
      location.course.mergedInto,
    );
  }

  if (
    (location.course.colSpan ?? 1) > 1 ||
    (location.course.rowSpan ?? 1) > 1
  ) {
    return splitCourseCardPreservingMembers(schedule, courseId);
  }

  return schedule;
}

function autoSplitInconsistentMergedCourse(
  schedule: Schedule,
  courseId: string,
): Schedule {
  const location = findCourseLocation(schedule, courseId);
  if (!location) {
    return schedule;
  }

  const anchorLocation = findAnchorLocation(location);
  if (!anchorLocation) {
    return schedule;
  }

  const course = anchorLocation.course;
  const colSpan = course.colSpan ?? 1;
  const rowSpan = course.rowSpan ?? 1;
  if (colSpan <= 1 && rowSpan <= 1) {
    return schedule;
  }

  const reference = anchorLocation.row.courses[anchorLocation.weekday];
  const baseSignature = buildCourseSignature(reference);
  const members = collectMergedMemberCourses(anchorLocation);

  for (const neighbor of members) {
    if (buildCourseSignature(neighbor) !== baseSignature) {
      return splitCourseCardPreservingMembers(
        schedule,
        anchorLocation.course.id,
      );
    }
  }

  return schedule;
}

function splitCourseCardPreservingMembers(
  schedule: Schedule,
  courseId: string,
): Schedule {
  const location = findCourseLocation(schedule, courseId);
  if (!location) {
    return schedule;
  }

  if (location.course.mergedInto) {
    return splitCourseCardPreservingMembers(
      schedule,
      location.course.mergedInto,
    );
  }

  if (
    (location.course.rowSpan ?? 1) > 1 ||
    location.course.mergeDirection === "vertical"
  ) {
    return splitVerticalCourseCard(schedule, location, true);
  }

  if ((location.course.colSpan ?? 1) <= 1) {
    return schedule;
  }

  const span = location.course.colSpan ?? 1;
  const coveredWeekdays = location.weekdays.slice(
    location.weekdayIndex + 1,
    location.weekdayIndex + span,
  );
  const rows = schedule.rows.map((row, rowIndex) => {
    if (rowIndex !== location.rowIndex) {
      return row;
    }

    const courses = { ...row.courses };
    courses[location.weekday] = {
      ...location.course,
      colSpan: 1,
      rowSpan: 1,
      mergedInto: undefined,
      mergeDirection: undefined,
    };
    for (const weekday of coveredWeekdays) {
      courses[weekday] = {
        ...courses[weekday],
        colSpan: 1,
        rowSpan: 1,
        mergedInto: undefined,
        mergeDirection: undefined,
      };
    }

    return { ...row, courses };
  });

  return { ...schedule, rows };
}

function splitVerticalCourseCard(
  schedule: Schedule,
  location: CourseLocation,
  preserveMembers: boolean,
): Schedule {
  const span = location.course.rowSpan ?? 1;
  if (span <= 1) {
    return schedule;
  }

  const coveredRowIndexes = Array.from(
    { length: span },
    (_, index) => location.rowIndex + index,
  ).filter((rowIndex) => rowIndex < schedule.rows.length);
  const rows = schedule.rows.map((row, rowIndex) => {
    if (!coveredRowIndexes.includes(rowIndex)) {
      return row;
    }

    const currentCourse = row.courses[location.weekday];
    if (!currentCourse) {
      return row;
    }

    const nextCourse = preserveMembers
      ? currentCourse
      : {
          ...currentCourse,
          title: location.course.title,
          room: location.course.room,
          style: location.course.style,
          scheduleRule: location.course.scheduleRule,
          temporaryChanges: location.course.temporaryChanges,
        };

    return {
      ...row,
      courses: {
        ...row.courses,
        [location.weekday]: {
          ...nextCourse,
          colSpan: 1,
          rowSpan: 1,
          mergedInto: undefined,
          mergeDirection: undefined,
        },
      },
    };
  });

  return { ...schedule, rows };
}

function collectMergedMemberCourses(location: CourseLocation): CourseCell[] {
  if (
    (location.course.rowSpan ?? 1) > 1 ||
    location.course.mergeDirection === "vertical"
  ) {
    return location.rows
      .slice(
        location.rowIndex + 1,
        location.rowIndex + (location.course.rowSpan ?? 1),
      )
      .map((row) => row.courses[location.weekday])
      .filter((course): course is CourseCell =>
        Boolean(course && course.mergedInto === location.course.id),
      );
  }

  const coveredWeekdays = location.weekdays.slice(
    location.weekdayIndex + 1,
    location.weekdayIndex + (location.course.colSpan ?? 1),
  );
  return coveredWeekdays
    .map((weekday) => location.row.courses[weekday])
    .filter((course): course is CourseCell =>
      Boolean(course && course.mergedInto === location.course.id),
    );
}

function deleteCourseCard(schedule: Schedule, courseId: string): Schedule {
  const location = findCourseLocation(schedule, courseId);
  if (!location) {
    return schedule;
  }

  if (
    location.course.mergedInto ||
    (location.course.colSpan ?? 1) > 1 ||
    (location.course.rowSpan ?? 1) > 1
  ) {
    const splitSchedule = splitCourseCardPreservingMembers(
      schedule,
      location.course.mergedInto ?? courseId,
    );
    return resetSingleCourseCardConfig(splitSchedule, courseId);
  }

  return resetSingleCourseCardConfig(schedule, courseId);
}

function resetSingleCourseCardConfig(
  schedule: Schedule,
  courseId: string,
): Schedule {
  const location = findCourseLocation(schedule, courseId);
  if (!location) {
    return schedule;
  }

  const rows = schedule.rows.map((row, rowIndex) => {
    if (rowIndex !== location.rowIndex) {
      return row;
    }

    const courses = { ...row.courses };
    const target = courses[location.weekday];
    if (!target) {
      return row;
    }

    courses[location.weekday] = {
      ...target,
      title: "",
      room: "",
      hidden: true,
      colSpan: 1,
      rowSpan: 1,
      mergedInto: undefined,
      mergeDirection: undefined,
      style: createDefaultCourseCardStyle(),
      scheduleRule: {
        weekPattern: "all",
        applyWholeTerm: true,
        startDate: undefined,
        endDate: undefined,
      },
    };

    return { ...row, courses };
  });

  return { ...schedule, rows };
}

function createEmptyCourseCell(id: string): CourseCell {
  return {
    id,
    title: "",
    room: "",
    hidden: true,
    colSpan: 1,
    rowSpan: 1,
    scheduleRule: {
      weekPattern: "all",
      applyWholeTerm: true,
    },
    style: createDefaultCourseCardStyle(),
  };
}

function createDefaultCourseCardStyle(): CardStyle {
  return toCardStyle(defaultCardDraft);
}

function courseCardIdFor(weekday: Weekday, periodId: string): string {
  return `courseCard_${weekdayNumber(weekday)}_${periodOrder(periodId) ?? 1}`;
}

function weekdayNumber(weekday: Weekday): number {
  return allScheduleDays.findIndex((day) => day.id === weekday) + 1 || 1;
}

function buildCourseSignature(course: CourseCell): string {
  return [
    course.title,
    course.room ?? "",
    course.style?.baseColor ?? "",
    course.style?.backgroundColor ?? "",
    course.style?.color ?? "",
    course.style?.iconColor ?? "",
    course.style?.fontFamily ?? "",
    String(course.style?.fontSize ?? ""),
    course.style?.fontWeight ?? "",
    course.style?.displayMode ?? "",
    course.scheduleRule?.weekPattern ?? "all",
    course.scheduleRule?.applyWholeTerm ? "whole" : "range",
    course.scheduleRule?.startDate ?? "",
    course.scheduleRule?.endDate ?? "",
  ].join("::");
}

function findCourse(
  schedule: Schedule,
  courseId: string,
): CourseCell | undefined {
  return findCourseLocation(schedule, courseId)?.course;
}

function findPeriod(
  schedule: Schedule,
  periodId: string,
): PeriodInfo | undefined {
  const row = schedule.rows.find((item) => item.period.id === periodId);
  if (row) {
    return row.period;
  }

  return undefined;
}

function getAuthToolbarLabel(accountState: LocalAccountState): string {
  if (!accountState.loggedIn) {
    return "账号";
  }

  return accountState.user?.phone?.slice(-2) ?? "账";
}

function getAuthToolbarTitle(accountState: LocalAccountState): string {
  if (!accountState.loggedIn) {
    return "登录 / 账号";
  }

  return "账号";
}

function getToolbarSyncButtonState(
  accountState: LocalAccountState,
  syncStatus: LocalSyncStatus,
  manualSyncRunning: boolean,
): ToolbarSyncButtonState {
  if (!accountState.loggedIn) {
    return "disabled";
  }

  if (manualSyncRunning || syncStatus.syncing) {
    return "syncing";
  }

  if (!syncStatus.online) {
    return "offline";
  }

  if (syncStatus.lastSyncError || syncStatus.conflict) {
    return "error";
  }

  if (syncStatus.hasPendingChanges || syncStatus.hasRemoteChanges) {
    return "pending";
  }

  return "synced";
}

function getToolbarSyncTitle(
  accountState: LocalAccountState,
  syncStatus: LocalSyncStatus,
  manualSyncRunning: boolean,
): string {
  if (!accountState.loggedIn) {
    return "登录后可同步";
  }

  if (manualSyncRunning || syncStatus.syncing) {
    return "正在同步";
  }

  if (!syncStatus.online) {
    return "网络不可用，稍后再同步";
  }

  if (syncStatus.conflict) {
    return "本地和云端都有更新，请稍后处理";
  }

  if (syncStatus.lastSyncError) {
    return `同步失败：${syncStatus.lastSyncError}`;
  }

  if (syncStatus.hasPendingChanges) {
    return `有 ${syncStatus.dirtyCount} 项本地更改待同步`;
  }

  if (syncStatus.lastSyncedAt) {
    return `已同步：${syncStatus.lastSyncedAt}`;
  }

  return "已同步";
}
