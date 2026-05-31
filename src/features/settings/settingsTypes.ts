import type { CardStyle, CourseScheduleRule, CourseTemporaryChange, WorkdayMode } from "../schedule/types";

export type TermSettings = {
  startDate: string;
  endDate: string;
};

export type DividerStyle = "solid" | "dashed" | "dotted";
export type GridLineType = "none" | DividerStyle;
export type WidgetBackgroundMode = "solid" | "blur";

export type AppearanceSettings = {
  columnGap: number;
  rowDividerHeight: number;
  rowDividerStyle: DividerStyle;
  rowDividerColor: string;
  rowDividerOpacity: number;
  rowDividerThickness: number;
  backgroundMode: WidgetBackgroundMode;
  backgroundColor: string;
  backgroundOpacity: number;
  blurIntensity: number;
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

export type TemporaryChangeType = CourseTemporaryChange["type"];

export type TemporaryChangeDraft = CourseTemporaryChange & {
  replaceTitle: string;
  replaceSecondary: string;
  replaceColor: string;
};

export const defaultAppearanceSettings: AppearanceSettings = {
  columnGap: 10,
  rowDividerHeight: 4,
  rowDividerStyle: "solid",
  rowDividerColor: "#665b4e",
  rowDividerOpacity: 0.16,
  rowDividerThickness: 1,
  backgroundMode: "blur",
  backgroundColor: "#DBE7EF",
  backgroundOpacity: 84,
  blurIntensity: 14,
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
    backgroundMode: appearance?.backgroundMode === "solid" ? "solid" : defaultAppearanceSettings.backgroundMode,
    backgroundColor: appearance?.backgroundColor ?? defaultAppearanceSettings.backgroundColor,
    backgroundOpacity: normalizePercent(appearance?.backgroundOpacity, defaultAppearanceSettings.backgroundOpacity),
    blurIntensity: normalizeRange(appearance?.blurIntensity, defaultAppearanceSettings.blurIntensity, 0, 40),
    cardRadius: normalizeCardRadius(appearance?.cardRadius),
    cardShadowStrength: normalizeCardShadowStrength(appearance?.cardShadowStrength),
    gridLineType: appearance?.gridLineType ?? defaultAppearanceSettings.gridLineType,
    gridLineColor: appearance?.gridLineColor ?? defaultAppearanceSettings.gridLineColor,
    gridLineWidth: typeof appearance?.gridLineWidth === "number" ? appearance.gridLineWidth : defaultAppearanceSettings.gridLineWidth,
    gridLineOpacity: typeof appearance?.gridLineOpacity === "number" ? appearance.gridLineOpacity : defaultAppearanceSettings.gridLineOpacity,
  };
}

function normalizePercent(value: number | undefined, fallback: number): number {
  return normalizeRange(value, fallback, 0, 100);
}

function normalizeRange(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
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

export function createDefaultTemporaryChangeDraft(date: string): TemporaryChangeDraft {
  return {
    id: `temporary-change-${date}-${Math.random().toString(16).slice(2, 8)}`,
    type: "cancel",
    dates: [date],
    replaceTitle: "",
    replaceSecondary: "",
    replaceColor: "#4f46e5",
  };
}

export function toCardStyle(draft: CardDraft): CardStyle {
  return {
    backgroundColor: draft.backgroundColor,
    color: draft.color,
    fontFamily: draft.fontFamily,
    fontSize: draft.fontSize,
  };
}
