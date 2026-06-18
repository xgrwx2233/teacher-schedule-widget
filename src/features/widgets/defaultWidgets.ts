import type { WidgetRegistryState } from "./types";

export const scheduleWidgetId = "schedule-main";

export const defaultWidgetRegistry: WidgetRegistryState = {
  activeWidgetId: scheduleWidgetId,
  widgets: [
    {
      id: scheduleWidgetId,
      type: "schedule",
      title: "教师课程表",
      mode: "attached",
      bounds: {
        x: 520,
        y: 52,
        width: 525,
        height: 760,
      },
      skinId: "midnight-coral",
      visible: true,
    },
  ],
};
