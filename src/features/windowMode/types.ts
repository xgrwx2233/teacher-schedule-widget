export type WindowMode = "attached" | "detached";

export type DesktopInputEvent = {
  kind: "hover" | "leave" | "move" | "click";
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WindowModeState = {
  mode: WindowMode;
};

export type ProxyWidgetHit =
  | { kind: "menu-button"; id?: string }
  | { kind: "auth-button"; id?: string }
  | { kind: "header-toggle"; id?: string }
  | { kind: "layout-toggle"; id?: string }
  | { kind: "previous-week"; id?: string }
  | { kind: "next-week"; id?: string }
  | { kind: "course"; id: string }
  | { kind: "period"; id: string }
  | { kind: "placeholder"; id: string };

export type ProxyHitboxProbe = {
  screenX: number;
  screenY: number;
  localX: number;
  localY: number;
  widgetHit: ProxyWidgetHit | null;
};

export type ProxyHitboxResult = {
  screenX: number;
  screenY: number;
  localX: number;
  localY: number;
  canInteract: boolean;
  desktopIconHit: boolean;
  widgetHit: ProxyWidgetHit | null;
};
