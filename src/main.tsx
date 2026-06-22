import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { AuthWindowHost } from "./app/AuthWindowHost";
import { CardSettingsWindowHost } from "./app/CardSettingsWindowHost";
import { ChatHistoryWindowHost } from "./app/ChatHistoryWindowHost";
import { ChatWindowHost } from "./app/ChatWindowHost";
import { FriendProfileWindowHost } from "./app/FriendProfileWindowHost";
import { FriendRequestWindowHost } from "./app/FriendRequestWindowHost";
import { FloatingToolbarWindowHost } from "./app/FloatingToolbarWindowHost";
import { GroupAnnouncementWindowHost } from "./app/GroupAnnouncementWindowHost";
import { ImagePreviewWindowHost } from "./app/ImagePreviewWindowHost";
import { InteractionProxyHost } from "./app/InteractionProxyHost";
import { ProfileEditWindowHost } from "./app/ProfileEditWindowHost";
import { ProfileSearchWindowHost } from "./app/ProfileSearchWindowHost";
import { SettingsWindowHost } from "./app/SettingsWindowHost";
import { WidgetMenuWindowHost } from "./app/WidgetMenuWindowHost";
import {
  CARD_SETTINGS_WINDOW_LABEL,
  PERIOD_CARD_SETTINGS_WINDOW_LABEL,
  AUTH_WINDOW_LABEL,
  CHAT_HISTORY_WINDOW_LABEL,
  CHAT_WINDOW_LABEL,
  FRIEND_PROFILE_WINDOW_LABEL,
  FRIEND_REQUEST_WINDOW_LABEL,
  FLOATING_TOOLBAR_WINDOW_LABEL,
  GROUP_ANNOUNCEMENT_WINDOW_LABEL,
  IMAGE_PREVIEW_WINDOW_LABEL,
  PROFILE_EDIT_WINDOW_LABEL,
  PROFILE_SEARCH_WINDOW_LABEL,
  SETTINGS_WINDOW_LABEL,
  WIDGET_MENU_WINDOW_LABEL,
} from "./features/settings/windowEvents";
import { INTERACTION_PROXY_LABEL } from "./features/windowMode/proxyEvents";
import "./styles/base.css";
import "./styles/themes/midnight-coral.css";

const windowLabel =
  new URLSearchParams(window.location.search).get("window") || window.location.hash.replace("#", "");

function resolveRootComponent() {
  if (windowLabel === SETTINGS_WINDOW_LABEL) return SettingsWindowHost;
  if (windowLabel === AUTH_WINDOW_LABEL) return AuthWindowHost;
  if (windowLabel === CHAT_WINDOW_LABEL) return ChatWindowHost;
  if (windowLabel === CHAT_HISTORY_WINDOW_LABEL) return ChatHistoryWindowHost;
  if (windowLabel === GROUP_ANNOUNCEMENT_WINDOW_LABEL) return GroupAnnouncementWindowHost;
  if (windowLabel === PROFILE_EDIT_WINDOW_LABEL) return ProfileEditWindowHost;
  if (windowLabel === FRIEND_PROFILE_WINDOW_LABEL) return FriendProfileWindowHost;
  if (windowLabel === PROFILE_SEARCH_WINDOW_LABEL) return ProfileSearchWindowHost;
  if (windowLabel === FRIEND_REQUEST_WINDOW_LABEL) return FriendRequestWindowHost;
  if (windowLabel === IMAGE_PREVIEW_WINDOW_LABEL) return ImagePreviewWindowHost;
  if (
    windowLabel === CARD_SETTINGS_WINDOW_LABEL ||
    windowLabel === PERIOD_CARD_SETTINGS_WINDOW_LABEL
  ) {
    return CardSettingsWindowHost;
  }
  if (windowLabel === INTERACTION_PROXY_LABEL) return InteractionProxyHost;
  if (windowLabel === WIDGET_MENU_WINDOW_LABEL) return WidgetMenuWindowHost;
  if (windowLabel === FLOATING_TOOLBAR_WINDOW_LABEL) {
    return FloatingToolbarWindowHost;
  }
  return App;
}

const RootComponent = resolveRootComponent();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>,
);
