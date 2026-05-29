import type { CardStyle, CourseScheduleRule, WorkdayMode } from "../schedule/types";

export type TermSettings = {
  startDate: string;
  endDate: string;
};

export type DividerStyle = "solid" | "dashed" | "dotted";
export type GridLineType = "none" | DividerStyle;

export type AppearanceSettings = {
  columnGap: number;
  rowDividerHeight: number;
  rowDividerStyle: DividerStyle;
  rowDividerColor: string;
  rowDividerOpacity: number;
  rowDividerThickness: number;
  cardRadius: number;
  cardShadowStrength: number;
  gridLineType: GridLineType;
  gridLineColor: string;
  gridLineWidth: number;
  gridLineOpacity: number;
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
  cardRadius: 12,
  cardShadowStrength: 2,
  gridLineType: "solid",
  gridLineColor: "#e5eaf2",
  gridLineWidth: 1,
  gridLineOpacity: 18,
};

export const cardShadowStrengthLabels = ["无阴影", "极轻", "轻", "标准", "明显"] as const;

export function normalizeCardRadius(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultAppearanceSettings.cardRadius;
  }

  return Math.max(0, Math.min(24, Math.round(value)));
}

export function normalizeCardShadowStrength(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultAppearanceSettings.cardShadowStrength;
  }

  return Math.max(0, Math.min(4, Math.round(value)));
}

export function normalizeAppearanceSettings(appearance?: Partial<AppearanceSettings> | null): AppearanceSettings {
  return {
    columnGap: appearance?.columnGap ?? defaultAppearanceSettings.columnGap,
    rowDividerHeight: appearance?.rowDividerHeight ?? defaultAppearanceSettings.rowDividerHeight,
    rowDividerStyle: appearance?.rowDividerStyle ?? defaultAppearanceSettings.rowDividerStyle,
    rowDividerColor: appearance?.rowDividerColor ?? defaultAppearanceSettings.rowDividerColor,
    rowDividerOpacity: appearance?.rowDividerOpacity ?? defaultAppearanceSettings.rowDividerOpacity,
    rowDividerThickness: appearance?.rowDividerThickness ?? defaultAppearanceSettings.rowDividerThickness,
    cardRadius: normalizeCardRadius(appearance?.cardRadius),
    cardShadowStrength: normalizeCardShadowStrength(appearance?.cardShadowStrength),
    gridLineType: appearance?.gridLineType ?? defaultAppearanceSettings.gridLineType,
    gridLineColor: appearance?.gridLineColor ?? defaultAppearanceSettings.gridLineColor,
    gridLineWidth: typeof appearance?.gridLineWidth === "number" ? appearance.gridLineWidth : defaultAppearanceSettings.gridLineWidth,
    gridLineOpacity: typeof appearance?.gridLineOpacity === "number" ? appearance.gridLineOpacity : defaultAppearanceSettings.gridLineOpacity,
  };
}

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
