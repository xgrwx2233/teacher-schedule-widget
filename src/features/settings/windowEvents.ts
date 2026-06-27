import type {
  CardDraft,
  CourseCardMergeState,
  SelectedCard,
  SettingsSection,
  TemporaryChangeDraft,
  WidgetBackgroundMode,
  WidgetSettingsState,
  PeriodConfigItem,
} from "./settingsTypes";
import type { WindowMode } from "../windowMode/types";

export const SETTINGS_WINDOW_LABEL = "settings";
export const CARD_SETTINGS_WINDOW_LABEL = "card-settings";
export const PERIOD_CARD_SETTINGS_WINDOW_LABEL = "period-card-settings";
export const WIDGET_MENU_WINDOW_LABEL = "widget-menu";
export const FLOATING_TOOLBAR_WINDOW_LABEL = "floating-toolbar";
export const WIDGET_WINDOW_LABEL = "widget";
export const AUTH_WINDOW_LABEL = "auth";
export const CHAT_WINDOW_LABEL = "chat";
export const PROFILE_EDIT_WINDOW_LABEL = "profile-edit";
export const CLASS_ACCOUNT_EDIT_WINDOW_LABEL = "class-account-edit";
export const FRIEND_PROFILE_WINDOW_LABEL = "friend-profile";
export const PROFILE_SEARCH_WINDOW_LABEL = "profile-search";
export const FRIEND_REQUEST_WINDOW_LABEL = "friend-request";
export const IMAGE_PREVIEW_WINDOW_LABEL = "image-preview";
export const MEDIA_VIEWER_WINDOW_LABEL = "media-viewer";
export const SCREENSHOT_WINDOW_LABEL = "screenshot";
export const CHAT_HISTORY_WINDOW_LABEL = "chat-history";
export const GROUP_ANNOUNCEMENT_WINDOW_LABEL = "group-announcements";
export const DRIVE_WINDOW_LABEL = "drive";

export const SETTINGS_WINDOW_STATE_EVENT = "settings-window-state";
export const SETTINGS_WINDOW_STATE_REQUEST_EVENT =
  "settings-window-state-request";
export const SETTINGS_WINDOW_UPDATE_EVENT = "settings-window-update";
export const SETTINGS_WINDOW_CLOSE_EVENT = "settings-window-close";

export const CARD_SETTINGS_WINDOW_STATE_EVENT = "card-settings-window-state";
export const CARD_SETTINGS_WINDOW_STATE_REQUEST_EVENT =
  "card-settings-window-state-request";
export const CARD_SETTINGS_WINDOW_UPDATE_EVENT = "card-settings-window-update";
export const CARD_SETTINGS_WINDOW_CLOSE_EVENT = "card-settings-window-close";
export const CARD_SETTINGS_WINDOW_ACTION_EVENT = "card-settings-window-action";

export const WIDGET_MENU_ACTION_EVENT = "widget-menu-action";
export const WIDGET_MENU_STATE_EVENT = "widget-menu-state";
export const WIDGET_MENU_CLOSE_EVENT = "widget-menu-close";
export const FLOATING_TOOLBAR_ACTION_EVENT = "floating-toolbar-action";
export const FLOATING_TOOLBAR_STATE_EVENT = "floating-toolbar-state";
export const FLOATING_TOOLBAR_CLOSE_EVENT = "floating-toolbar-close";
export const AUTH_STATE_CHANGED_EVENT = "auth-state-changed";
export const AUTH_WINDOW_CLOSED_EVENT = "auth-window-closed";
export const FRIEND_PROFILE_OPEN_EVENT = "friend-profile-open";
export const FRIEND_REQUEST_OPEN_EVENT = "friend-request-open";
export const IMAGE_PREVIEW_OPEN_EVENT = "image-preview-open";
export const MEDIA_VIEWER_OPEN_EVENT = "media-viewer-open";
export const CHAT_HISTORY_OPEN_EVENT = "chat-history-open";
export const GROUP_ANNOUNCEMENT_OPEN_EVENT = "group-announcement-open";
export const DRIVE_OPEN_EVENT = "drive-open";
export const SCREENSHOT_OPEN_EVENT = "screenshot-open";
export const FRIEND_REQUEST_SENT_EVENT = "friend-request-sent";
export const FRIEND_REQUEST_EVENT = "friend-request-event";
export const CHAT_GROUP_EVENT = "chat-group-event";
export const CHAT_OPEN_CONVERSATION_EVENT = "chat-open-conversation";
export const CHAT_FORWARD_MESSAGE_EVENT = "chat-forward-message";
export const CHAT_QUOTE_MESSAGE_EVENT = "chat-quote-message";
export const CHAT_LOCATE_MESSAGE_EVENT = "chat-locate-message";
export const PROFILE_UPDATED_EVENT = "profile-updated";

export type WidgetMenuAction = "settings" | "mode" | "hide";
export type ToolbarLayoutMode = "normal" | "minimalist";
export type FloatingToolbarAction =
  | "previous-week"
  | "next-week"
  | "layout"
  | "auth"
  | "sync"
  | "menu";
export type FloatingToolbarSyncButtonState =
  | "disabled"
  | "synced"
  | "pending"
  | "syncing"
  | "error"
  | "offline";

export type WidgetMenuStatePayload = {
  mode: WindowMode;
  weekNumber?: number;
};

export type FloatingToolbarStatePayload = {
  weekNumber: number;
  menuOpen: boolean;
  toolbarLayoutMode: ToolbarLayoutMode;
  backgroundMode: WidgetBackgroundMode;
  canPreviousWeek: boolean;
  canNextWeek: boolean;
  authLabel: string;
  authTitle: string;
  loggedIn: boolean;
  syncButtonState: FloatingToolbarSyncButtonState;
  syncTitle: string;
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
  periods: PeriodConfigItem[];
  windowMode?: WindowMode;
};

export type SettingsWindowUpdatePayload = {
  windowLabel: string;
  settings: WidgetSettingsState;
  activeSection: SettingsSection;
  periods: PeriodConfigItem[];
  windowMode?: WindowMode;
};

export type SettingsWindowStateRequestPayload = {
  windowLabel: string;
};

export type CardSettingsWindowStatePayload = {
  windowLabel: string;
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
  action:
    | "merge-up"
    | "merge-left"
    | "merge-right"
    | "merge-down"
    | "split"
    | "delete"
    | "apply-style"
    | "apply-schedule";
  draft?: CardDraft;
  temporaryChanges?: TemporaryChangeDraft[];
  activeTemporaryChangeId?: string | null;
};

export type CardSettingsWindowStateRequestPayload = {
  windowLabel: string;
};
