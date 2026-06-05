import type {
  CardDraft,
  CourseCardMergeState,
  SelectedCard,
  SettingsSection,
  TemporaryChangeDraft,
  WidgetBackgroundMode,
  WidgetSettingsState,
} from "./settingsTypes";
import type { WindowMode } from "../windowMode/types";

export const SETTINGS_WINDOW_LABEL = "settings";
export const CARD_SETTINGS_WINDOW_LABEL = "card-settings";
export const WIDGET_MENU_WINDOW_LABEL = "widget-menu";
export const FLOATING_TOOLBAR_WINDOW_LABEL = "floating-toolbar";
export const WIDGET_WINDOW_LABEL = "widget";

export const SETTINGS_WINDOW_STATE_EVENT = "settings-window-state";
export const SETTINGS_WINDOW_STATE_REQUEST_EVENT = "settings-window-state-request";
export const SETTINGS_WINDOW_UPDATE_EVENT = "settings-window-update";
export const SETTINGS_WINDOW_CLOSE_EVENT = "settings-window-close";

export const CARD_SETTINGS_WINDOW_STATE_EVENT = "card-settings-window-state";
export const CARD_SETTINGS_WINDOW_STATE_REQUEST_EVENT = "card-settings-window-state-request";
export const CARD_SETTINGS_WINDOW_UPDATE_EVENT = "card-settings-window-update";
export const CARD_SETTINGS_WINDOW_CLOSE_EVENT = "card-settings-window-close";
export const CARD_SETTINGS_WINDOW_ACTION_EVENT = "card-settings-window-action";

export const WIDGET_MENU_ACTION_EVENT = "widget-menu-action";
export const WIDGET_MENU_STATE_EVENT = "widget-menu-state";
export const WIDGET_MENU_CLOSE_EVENT = "widget-menu-close";
export const FLOATING_TOOLBAR_ACTION_EVENT = "floating-toolbar-action";
export const FLOATING_TOOLBAR_STATE_EVENT = "floating-toolbar-state";
export const FLOATING_TOOLBAR_CLOSE_EVENT = "floating-toolbar-close";

export type WidgetMenuAction = "settings" | "mode" | "hide";
export type ToolbarLayoutMode = "normal" | "minimalist";
export type FloatingToolbarAction = "previous-week" | "next-week" | "layout" | "menu";

export type WidgetMenuStatePayload = {
  mode: WindowMode;
  weekNumber?: number;
};

export type FloatingToolbarStatePayload = {
  weekNumber: number;
  menuOpen: boolean;
  toolbarLayoutMode: ToolbarLayoutMode;
  backgroundMode: WidgetBackgroundMode;
};

export type FloatingToolbarActionPayload = {
  action: FloatingToolbarAction;
  windowLabel?: string;
  anchor?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type SettingsWindowStatePayload = {
  settings: WidgetSettingsState;
  activeSection: SettingsSection;
  windowMode?: WindowMode;
};

export type SettingsWindowUpdatePayload = {
  windowLabel: string;
  settings: WidgetSettingsState;
  activeSection: SettingsSection;
  windowMode?: WindowMode;
};

export type SettingsWindowStateRequestPayload = {
  windowLabel: string;
};

export type CardSettingsWindowStatePayload = {
  selectedCard: SelectedCard;
  draft: CardDraft;
  mergeState: CourseCardMergeState;
  term: WidgetSettingsState["term"];
  titleContext?: CardSettingsTitleContext;
  temporaryChanges?: TemporaryChangeDraft[];
  activeTemporaryChangeId?: string | null;
};

export type CardSettingsTitleContext = {
  date?: string;
  dateLabel?: string;
  weekdayLabel?: string;
  periodLabel?: string;
};

export type CardSettingsWindowUpdatePayload = {
  windowLabel: string;
  selectedCard: SelectedCard;
  draft: CardDraft;
  temporaryChanges?: TemporaryChangeDraft[];
  activeTemporaryChangeId?: string | null;
};

export type CardSettingsWindowActionPayload = {
  windowLabel: string;
  selectedCard: SelectedCard;
  action: "merge-up" | "merge-left" | "merge-right" | "merge-down" | "split" | "delete" | "add" | "apply-style" | "apply-schedule";
  draft?: CardDraft;
  temporaryChanges?: TemporaryChangeDraft[];
  activeTemporaryChangeId?: string | null;
};

export type CardSettingsWindowStateRequestPayload = {
  windowLabel: string;
};
