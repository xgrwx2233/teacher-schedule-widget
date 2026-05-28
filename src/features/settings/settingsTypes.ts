import type { CardStyle, CourseScheduleRule, WorkdayMode } from "../schedule/types";

export type TermSettings = {
  startDate: string;
  endDate: string;
};

export type BlockRowType = "course";

export type BlockPeriodSettings = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  order: number;
  conflict: boolean;
  type: BlockRowType;
};

export type BlockSettings = {
  id: string;
  name: string;
  cardBackgroundColor: string;
  cardCornerRadius: number;
  periods: BlockPeriodSettings[];
};

export type BlockSettingsState = {
  activeBlockId: string | null;
  activePeriodId: string | null;
  blocks: BlockSettings[];
};

export type DividerStyle = "solid" | "dashed" | "dotted";

export type AppearanceSettings = {
  columnGap: number;
  rowDividerHeight: number;
  rowDividerStyle: DividerStyle;
  rowDividerColor: string;
  rowDividerOpacity: number;
  rowDividerThickness: number;
  blockCardBackgroundColor: string;
  blockCardCornerRadius: number;
  blockHeights: Record<string, number>;
};

export type WidgetSettingsState = {
  workdayMode: WorkdayMode;
  periodCount: number;
  term: TermSettings;
  blockSettings: BlockSettingsState;
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

export const defaultBlockSettingsState: BlockSettingsState = {
  activeBlockId: "morning",
  activePeriodId: "p1",
  blocks: [
    {
      id: "morning",
      name: "上午",
      cardBackgroundColor: "#fff8e1",
      cardCornerRadius: 12,
      periods: [
        { id: "p1", name: "第1节", startTime: "08:00", endTime: "08:45", order: 0, conflict: false, type: "course" },
        { id: "p2", name: "第2节", startTime: "08:55", endTime: "09:40", order: 1, conflict: false, type: "course" },
        { id: "p3", name: "第3节", startTime: "10:10", endTime: "10:55", order: 2, conflict: false, type: "course" },
        { id: "p4", name: "第4节", startTime: "11:05", endTime: "11:50", order: 3, conflict: false, type: "course" },
      ],
    },
    {
      id: "lunch",
      name: "午休",
      cardBackgroundColor: "#e3f2fd",
      cardCornerRadius: 12,
      periods: [
        { id: "lunch", name: "午休", startTime: "12:00", endTime: "14:00", order: 0, conflict: false, type: "course" },
      ],
    },
    {
      id: "afternoon",
      name: "下午",
      cardBackgroundColor: "#e8f5e9",
      cardCornerRadius: 12,
      periods: [
        { id: "p5", name: "第5节", startTime: "14:30", endTime: "15:15", order: 0, conflict: false, type: "course" },
        { id: "p6", name: "第6节", startTime: "15:25", endTime: "16:10", order: 1, conflict: false, type: "course" },
        { id: "p7", name: "第7节", startTime: "16:20", endTime: "17:05", order: 2, conflict: false, type: "course" },
        { id: "p8", name: "第8节", startTime: "17:15", endTime: "18:00", order: 3, conflict: false, type: "course" },
      ],
    },
  ],
};

export const defaultAppearanceSettings: AppearanceSettings = {
  columnGap: 10,
  rowDividerHeight: 4,
  rowDividerStyle: "solid",
  rowDividerColor: "#665b4e",
  rowDividerOpacity: 0.16,
  rowDividerThickness: 1,
  blockCardBackgroundColor: "#fff8e1",
  blockCardCornerRadius: 10,
  blockHeights: {
    morning: 4,
    lunch: 1.15,
    afternoon: 4,
  },
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
