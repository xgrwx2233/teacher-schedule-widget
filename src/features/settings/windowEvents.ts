import type { CardDraft, SelectedCard, SettingsSection, WidgetSettingsState } from "./settingsTypes";
import type { BlockSettings } from "./settingsTypes";
import type { WindowMode } from "../windowMode/types";

export const SETTINGS_WINDOW_LABEL = "settings";
export const CARD_SETTINGS_WINDOW_LABEL = "card-settings";
export const WIDGET_MENU_WINDOW_LABEL = "widget-menu";
export const BLOCK_SETTINGS_WINDOW_LABEL = "block-settings";
export const BLOCK_TYPE_CONFIRM_WINDOW_LABEL = "block-type-confirm";
export const WIDGET_WINDOW_LABEL = "widget";

export const SETTINGS_WINDOW_STATE_EVENT = "settings-window-state";
export const SETTINGS_WINDOW_STATE_REQUEST_EVENT = "settings-window-state-request";
export const SETTINGS_WINDOW_UPDATE_EVENT = "settings-window-update";
export const SETTINGS_WINDOW_CLOSE_EVENT = "settings-window-close";

export const CARD_SETTINGS_WINDOW_STATE_EVENT = "card-settings-window-state";
export const CARD_SETTINGS_WINDOW_STATE_REQUEST_EVENT = "card-settings-window-state-request";
export const CARD_SETTINGS_WINDOW_UPDATE_EVENT = "card-settings-window-update";
export const CARD_SETTINGS_WINDOW_CLOSE_EVENT = "card-settings-window-close";

export const BLOCK_SETTINGS_WINDOW_STATE_EVENT = "block-settings-window-state";
export const BLOCK_SETTINGS_WINDOW_CLOSE_EVENT = "block-settings-window-close";
export const BLOCK_TYPE_CONFIRM_REQUEST_EVENT = "block-type-confirm-request";
export const BLOCK_TYPE_CONFIRM_RESPONSE_EVENT = "block-type-confirm-response";

export const WIDGET_MENU_ACTION_EVENT = "widget-menu-action";
export const WIDGET_MENU_STATE_EVENT = "widget-menu-state";
export const WIDGET_MENU_CLOSE_EVENT = "widget-menu-close";

export type WidgetMenuAction = "settings" | "mode" | "hide";

export type WidgetMenuStatePayload = {
  mode: WindowMode;
};

export type SettingsWindowStatePayload = {
  settings: WidgetSettingsState;
  activeSection: SettingsSection;
};

export type SettingsWindowUpdatePayload = {
  windowLabel: string;
  settings: WidgetSettingsState;
  activeSection: SettingsSection;
  applyBlockSettings?: boolean;
};

export type SettingsWindowStateRequestPayload = {
  windowLabel: string;
};

export type CardSettingsWindowStatePayload = {
  selectedCard: SelectedCard;
  draft: CardDraft;
};

export type CardSettingsWindowUpdatePayload = {
  windowLabel: string;
  selectedCard: SelectedCard;
  draft: CardDraft;
};

export type CardSettingsWindowStateRequestPayload = {
  windowLabel: string;
};

export type BlockSettingsWindowStatePayload = {
  settings: WidgetSettingsState;
  activeBlockId?: string;
  block?: BlockSettings;
};

export type BlockTypeConfirmRequestPayload = {
  requestId: string;
  sourceWindowLabel: string;
  title: string;
  message: string;
  detail?: string;
};

export type BlockTypeConfirmResponsePayload = {
  requestId: string;
  confirmed: boolean;
};
