import type { CardStyle, CourseCardDisplayMode, CourseCardFontWeight, CourseScheduleRule, CourseTemporaryChange, WorkdayMode } from "../schedule/types";

export type TermSettings = {
  startDate: string;
  endDate: string;
};

export type DividerStyle = "solid" | "dashed" | "dotted";
export type GridLineType = "none" | DividerStyle;
export type WidgetBackgroundMode = "solid" | "blur";
export type AxisColorMode = "auto" | "light" | "dark";
export type PeriodColumnStyle = "soft" | "transparent" | "solid";

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
  axisColorMode: AxisColorMode;
  periodColumnStyle: PeriodColumnStyle;
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
  canMergeUp: boolean;
  canMergeLeft: boolean;
  canMergeRight: boolean;
  canMergeDown: boolean;
  canSplit: boolean;
  reason?: string;
};

export type CardDraft = {
  title: string;
  secondary: string;
  backgroundColor: string;
  color: string;
  iconColor: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: CourseCardFontWeight;
  displayMode: CourseCardDisplayMode;
  weekPattern: CourseScheduleRule["weekPattern"];
  applyWholeTerm: boolean;
  startDate: string;
  endDate: string;
};

export type TemporaryChangeType = CourseTemporaryChange["type"];

export type TemporaryChangeDraft = CourseTemporaryChange & {
  title: string;
  subtitle: string;
  color: string;
  style: Pick<CardStyle, "fontFamily" | "fontSize" | "fontWeight" | "displayMode">;
  createdAt: string;
  updatedAt: string;
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
  backgroundColor: "#062032",
  backgroundOpacity: 0,
  blurIntensity: 14,
  cardRadius: 12,
  cardShadowStrength: 2,
  gridLineType: "solid",
  gridLineColor: "#e5eaf2",
  gridLineWidth: 1,
  gridLineOpacity: 18,
  axisColorMode: "auto",
  periodColumnStyle: "transparent",
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
    axisColorMode: normalizeAxisColorMode(appearance?.axisColorMode),
    periodColumnStyle: normalizePeriodColumnStyle(appearance?.periodColumnStyle),
  };
}

function normalizeAxisColorMode(value: AxisColorMode | undefined): AxisColorMode {
  if (value === "light" || value === "dark") {
    return value;
  }

  return defaultAppearanceSettings.axisColorMode;
}

function normalizePeriodColumnStyle(value: PeriodColumnStyle | undefined): PeriodColumnStyle {
  if (value === "soft" || value === "transparent" || value === "solid") {
    return value;
  }

  return defaultAppearanceSettings.periodColumnStyle;
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
  iconColor: "#b97916",
  fontFamily: "Microsoft YaHei",
  fontSize: 14,
  fontWeight: "medium",
  displayMode: "auto",
  weekPattern: "all",
  applyWholeTerm: true,
  startDate: "2026-03-05",
  endDate: "2026-06-30",
};

export function createDefaultTemporaryChangeDraft(date: string): TemporaryChangeDraft {
  const now = new Date().toISOString();
  return {
    id: `temporary-change-${date}-${Math.random().toString(16).slice(2, 8)}`,
    type: "cancel",
    dates: [date],
    title: "",
    subtitle: "",
    color: "#4f46e5",
    style: {
      fontFamily: "Microsoft YaHei",
      fontSize: 14,
      fontWeight: "medium",
      displayMode: "auto",
    },
    createdAt: now,
    updatedAt: now,
    replaceTitle: "",
    replaceSecondary: "",
    replaceColor: "#4f46e5",
  };
}

export function toCardStyle(draft: CardDraft): CardStyle {
  const palette = computeCoursePalette(draft.backgroundColor);
  return {
    baseColor: draft.backgroundColor,
    backgroundColor: palette.backgroundColor,
    color: palette.color,
    iconColor: palette.iconColor,
    fontFamily: draft.fontFamily,
    fontSize: draft.fontSize,
    fontWeight: draft.fontWeight,
    displayMode: draft.displayMode,
  };
}

export type ComputedCardPalette = {
  backgroundColor: string;
  color: string;
  iconColor: string;
};

export const courseCardPresetColors = [
  { name: "日落橙", value: "#FF6B35" },
  { name: "阳光黄", value: "#FFD166" },
  { name: "薄荷绿", value: "#06D6A0" },
  { name: "晴空蓝", value: "#118AB2" },
  { name: "薰衣紫", value: "#9B5DE5" },
  { name: "珊瑚粉", value: "#F15BB5" },
  { name: "奶油白", value: "#F0E5CF" },
] as const;

export function isPresetCourseColor(value: string): boolean {
  return courseCardPresetColors.some((color) => color.value.toLowerCase() === value.trim().toLowerCase());
}

export function computeCoursePalette(baseColor: string): ComputedCardPalette {
  const { r, g, b } = parseHexColor(baseColor);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  const color = deriveReadableAccentColor(r, g, b);
  return {
    backgroundColor: blendWithWhiteHex(r, g, b, luminance > 205 && saturation < 0.22 ? 0.9 : 0.84),
    color,
    iconColor: color,
  };
}

export function applyComputedCoursePalette(draft: CardDraft, baseColor: string): CardDraft {
  const palette = computeCoursePalette(baseColor);
  return {
    ...draft,
    backgroundColor: baseColor,
    color: palette.color,
    iconColor: palette.iconColor,
  };
}

function parseHexColor(value: string): { r: number; g: number; b: number } {
  const normalized = value.trim().replace(/^#/, "");
  const expanded = normalized.length === 3 ? normalized.split("").map((item) => item + item).join("") : normalized;
  const match = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expanded);
  if (!match) {
    return { r: 255, g: 255, b: 255 };
  }

  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

function deriveReadableAccentColor(r: number, g: number, b: number): string {
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;

  if (luminance > 205 && saturation < 0.22) {
    return rgbToHex(
      Math.round(r * 0.45),
      Math.round(g * 0.42),
      Math.round(b * 0.38),
    );
  }

  const mixWithBlack = luminance > 185 ? 0.48 : luminance > 145 ? 0.38 : 0.24;
  return rgbToHex(
    Math.round(r * (1 - mixWithBlack)),
    Math.round(g * (1 - mixWithBlack)),
    Math.round(b * (1 - mixWithBlack)),
  );
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

function blendWithWhiteHex(r: number, g: number, b: number, whiteWeight: number): string {
  const ratio = Math.max(0, Math.min(1, whiteWeight));
  return rgbToHex(
    Math.round(r * (1 - ratio) + 255 * ratio),
    Math.round(g * (1 - ratio) + 255 * ratio),
    Math.round(b * (1 - ratio) + 255 * ratio),
  );
}
