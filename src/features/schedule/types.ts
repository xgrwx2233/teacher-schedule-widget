// Weekday is intentionally limited to teaching days shown by this desktop widget.
// Keeping it as a string union gives the timetable grid stable column keys.
export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type WorkdayMode = "mon-fri" | "mon-sat" | "mon-sun";

export type CardStyle = {
  backgroundColor?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
};

export type CourseScheduleRule = {
  weekPattern: "all" | "odd" | "even";
  applyWholeTerm: boolean;
  startDate?: string;
  endDate?: string;
};

// A schedule block is rendered as a vertical section: morning, noon placeholder,
// afternoon, and later evening/self-study if needed.
export type SchedulePhase = "morning" | "noon" | "afternoon";

// Header data for the date row. The date row uses the same grid columns as all
// schedule blocks, so every day header aligns with the course column underneath.
export type ScheduleDay = {
  id: Weekday;
  label: string;
  dateLabel: string;
};

// Period information is displayed in the left fixed column of every row.
export type PeriodInfo = {
  id: string;
  label: string;
  time: string;
  style?: CardStyle;
};

// A course cell is the smallest timetable unit. It can later be extended with
// teacher, subject id, color token, conflict status, or sync metadata.
export type CourseCell = {
  id: string;
  title: string;
  room?: string;
  note?: string;
  style?: CardStyle;
  scheduleRule?: CourseScheduleRule;
};

// One horizontal row inside a course block. The row owns one period label and
// exactly one course for each weekday column.
export type ScheduleCourseRow = {
  id: string;
  period: PeriodInfo;
  courses: Record<Weekday, CourseCell>;
};

// A course block is rendered as columns. Each column is a vertical container,
// and its rows are separated with thin dividers instead of external gaps.
export type ScheduleCourseBlock = {
  id: string;
  type: "course";
  phase: Exclude<SchedulePhase, "noon">;
  cardTone: "wheat" | "blue";
  rows: ScheduleCourseRow[];
};

// Placeholder blocks merge the weekday columns into one large card. Lunch,
// school events, exams, or whole-afternoon activities can reuse this shape.
export type SchedulePlaceholderBlock = {
  id: string;
  type: "placeholder";
  phase: "noon";
  period: PeriodInfo;
  title: string;
  subtitle?: string;
  style?: CardStyle;
};

export type ScheduleBlock = ScheduleCourseBlock | SchedulePlaceholderBlock;

// Top-level schedule data consumed by ScheduleWidget. The frontend currently
// uses mock data; the shape is ready to persist to SQLite later.
export type Schedule = {
  id: string;
  teacherName: string;
  weekNumber: number;
  termLabel: string;
  activeWeekday: Weekday;
  days: ScheduleDay[];
  blocks: ScheduleBlock[];
};
