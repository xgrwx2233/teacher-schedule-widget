import type { CardStyle, CourseCell, Schedule, ScheduleCourseRow, Weekday } from "./types";

export const allScheduleDays: Schedule["days"] = [
  { id: "monday", label: "周一", dateLabel: "05/18" },
  { id: "tuesday", label: "周二", dateLabel: "05/19" },
  { id: "wednesday", label: "周三", dateLabel: "05/20" },
  { id: "thursday", label: "周四", dateLabel: "05/21" },
  { id: "friday", label: "周五", dateLabel: "05/22" },
  { id: "saturday", label: "周六", dateLabel: "05/23" },
  { id: "sunday", label: "周日", dateLabel: "05/24" },
];

const weekdayIds = allScheduleDays.map((day) => day.id);

const palettes = {
  lavender: { baseColor: "#AF52DE", backgroundColor: "#f4eafa", color: "#692080", iconColor: "#692080" },
  mint: { baseColor: "#34C759", backgroundColor: "#e1f8e6", color: "#1f7735", iconColor: "#1f7735" },
  cream: { baseColor: "#FFCC00", backgroundColor: "#fff7d6", color: "#997a00", iconColor: "#997a00" },
  coral: { baseColor: "#FF3B30", backgroundColor: "#ffe3e0", color: "#99231d", iconColor: "#99231d" },
  peach: { baseColor: "#FF9500", backgroundColor: "#ffefd6", color: "#995900", iconColor: "#995900" },
  green: { baseColor: "#34C759", backgroundColor: "#e1f8e6", color: "#1f7735", iconColor: "#1f7735" },
} satisfies Record<string, CardStyle>;

type PaletteName = keyof typeof palettes;
type CourseEntry = {
  title: string;
  room?: string;
  color?: PaletteName;
  hidden?: boolean;
  weekPattern?: CourseCell["scheduleRule"] extends infer Rule
    ? Rule extends { weekPattern: infer Pattern }
      ? Pattern
      : never
    : never;
  colSpan?: number;
  rowSpan?: number;
  mergedInto?: string;
  mergeDirection?: CourseCell["mergeDirection"];
};

function emptyCourseCell(id: string): CourseCell {
  return {
    id,
    title: "",
    room: "",
    hidden: true,
    colSpan: 1,
    rowSpan: 1,
    scheduleRule: {
      weekPattern: "all",
      applyWholeTerm: true,
    },
    style: {
      baseColor: "#ffffff",
      backgroundColor: "#ffffff",
      color: "#64748b",
      iconColor: "#64748b",
      displayMode: "auto",
    },
  };
}

function courseCell(id: string, entry?: CourseEntry): CourseCell {
  if (!entry) {
    return emptyCourseCell(id);
  }

  const palette = palettes[entry.color ?? "lavender"];

  return {
    id,
    title: entry.title,
    room: entry.room ?? "",
    hidden: entry.hidden ?? false,
    colSpan: entry.colSpan ?? 1,
    rowSpan: entry.rowSpan ?? 1,
    mergedInto: entry.mergedInto,
    mergeDirection: entry.mergeDirection,
    scheduleRule: {
      weekPattern: entry.weekPattern ?? "all",
      applyWholeTerm: true,
    },
    style: {
      ...palette,
      displayMode: "auto",
      fontFamily: "Microsoft YaHei",
      fontWeight: "medium",
    },
  };
}

function row(
  id: string,
  label: string,
  time: string,
  entries: Partial<Record<Weekday, CourseEntry>>,
): ScheduleCourseRow {
  const courses = weekdayIds.reduce<Record<Weekday, CourseCell>>(
    (result, weekday) => {
      result[weekday] = courseCell(`${id}-${weekday}`, entries[weekday]);
      return result;
    },
    {} as Record<Weekday, CourseCell>,
  );

  return {
    id,
    period: { id, label, time },
    courses,
  };
}

export const mockSchedule: Schedule = {
  id: "mock-teacher-week",
  teacherName: "林老师",
  weekNumber: 1,
  termLabel: "2026 春季学期",
  activeWeekday: "tuesday",
  days: allScheduleDays.slice(0, 5),
  rows: [
    row("p1", "第1节", "08:00-08:45", {
      monday: { title: "1班", room: "八年级", color: "lavender" },
      wednesday: { title: "3班", room: "高一3班", color: "mint" },
    }),
    row("p2", "第2节", "08:55-09:40", {
      tuesday: { title: "数学", room: "高一2班", color: "mint" },
      wednesday: { title: "物理", room: "高一3班", color: "coral" },
    }),
    row("p3", "第3节", "10:10-10:55", {
      tuesday: { title: "数学", room: "高一2班", color: "mint" },
    }),
    row("p4", "第4节", "11:05-11:50", {
      monday: { title: "物理", room: "高一1班", color: "cream" },
      wednesday: { title: "生物", room: "高一3班", color: "mint", weekPattern: "even" },
    }),
    row("p5", "第5节", "14:30-15:15", {
      tuesday: { title: "教研", room: "语文组", color: "peach", hidden: true },
    }),
    row("p6", "第6节", "15:25-16:10", {
      tuesday: { title: "公开课", room: "录播室", color: "peach" },
      thursday: { title: "2班", room: "3年级", color: "green" },
    }),
    row("p7", "第7节", "16:20-17:05", {
      wednesday: { title: "3班", room: "八年级", color: "lavender" },
      thursday: { title: "作文", room: "办公室", color: "lavender" },
    }),
    row("p8", "第8节", "17:15-18:00", {}),
  ],
};
