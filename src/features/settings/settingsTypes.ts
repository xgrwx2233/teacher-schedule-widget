import type { CardStyle, CourseScheduleRule, WorkdayMode } from "../schedule/types";

export type TermSettings = {
  startDate: string;
  endDate: string;
};

export type DividerStyle = "solid" | "dashed" | "dotted";

export type AppearanceSettings = {
  columnGap: number;
  rowDividerHeight: number;
  rowDividerStyle: DividerStyle;
  rowDividerColor: string;
  rowDividerOpacity: number;
  rowDividerThickness: number;
};

export type WidgetSettingsState = {
  workdayMode: WorkdayMode;
  periodCount: number;
  term: TermSettings;
  appearance: AppearanceSettings;
};

export type SettingsSection = "schedule" | "term" | "appearance";

export type SelectedCard =
  | { type: "course"; courseId: string }
  | { type: "period"; periodId: string };

export type CourseCardMergeState = {
  canMergeRight: boolean;
  canSplit: boolean;
  reason?: string;
};

export type CardDraft = {
  title: string;
  secondary: string;
  backgroundColor: string;
  color: string;
  fontFamily: string;
  fontSize: number;
  weekPattern: CourseScheduleRule["weekPattern"];
  applyWholeTerm: boolean;
  startDate: string;
  endDate: string;
};

export const defaultAppearanceSettings: AppearanceSettings = {
  columnGap: 10,
  rowDividerHeight: 4,
  rowDividerStyle: "solid",
  rowDividerColor: "#665b4e",
  rowDividerOpacity: 0.16,
  rowDividerThickness: 1,
};

export const defaultCardDraft: CardDraft = {
  title: "",
  secondary: "",
  backgroundColor: "#fff8e1",
  color: "#b97916",
  fontFamily: "Microsoft YaHei",
  fontSize: 14,
  weekPattern: "all",
  applyWholeTerm: true,
  startDate: "2026-03-05",
  endDate: "2026-06-30",
};

export function toCardStyle(draft: CardDraft): CardStyle {
  return {
    backgroundColor: draft.backgroundColor,
    color: draft.color,
    fontFamily: draft.fontFamily,
    fontSize: draft.fontSize,
  };
}
