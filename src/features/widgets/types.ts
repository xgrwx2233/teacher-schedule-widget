import type { WindowMode } from "../windowMode/types";

export type WidgetType = "schedule" | "calendar";

export type WidgetBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WidgetInstance = {
  id: string;
  type: WidgetType;
  title: string;
  mode: WindowMode;
  bounds: WidgetBounds;
  skinId: string;
  visible: boolean;
};

export type WidgetRegistryState = {
  activeWidgetId: string;
  widgets: WidgetInstance[];
};
