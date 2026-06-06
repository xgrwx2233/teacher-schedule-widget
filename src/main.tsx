import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { AuthWindowHost } from "./app/AuthWindowHost";
import { CardSettingsWindowHost } from "./app/CardSettingsWindowHost";
import { FloatingToolbarWindowHost } from "./app/FloatingToolbarWindowHost";
import { InteractionProxyHost } from "./app/InteractionProxyHost";
import { SettingsWindowHost } from "./app/SettingsWindowHost";
import { WidgetMenuWindowHost } from "./app/WidgetMenuWindowHost";
import {
  CARD_SETTINGS_WINDOW_LABEL,
  AUTH_WINDOW_LABEL,
  FLOATING_TOOLBAR_WINDOW_LABEL,
  SETTINGS_WINDOW_LABEL,
  WIDGET_MENU_WINDOW_LABEL,
} from "./features/settings/windowEvents";
import { INTERACTION_PROXY_LABEL } from "./features/windowMode/proxyEvents";
import "./styles/base.css";
import "./styles/themes/midnight-coral.css";

const windowLabel =
  new URLSearchParams(window.location.search).get("window") || window.location.hash.replace("#", "");
const RootComponent =
  windowLabel === SETTINGS_WINDOW_LABEL
    ? SettingsWindowHost
    : windowLabel === AUTH_WINDOW_LABEL
      ? AuthWindowHost
    : windowLabel === CARD_SETTINGS_WINDOW_LABEL
        ? CardSettingsWindowHost
        : windowLabel === INTERACTION_PROXY_LABEL
          ? InteractionProxyHost
          : windowLabel === WIDGET_MENU_WINDOW_LABEL
            ? WidgetMenuWindowHost
            : windowLabel === FLOATING_TOOLBAR_WINDOW_LABEL
              ? FloatingToolbarWindowHost
            : App;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>,
);
