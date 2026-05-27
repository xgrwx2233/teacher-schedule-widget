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

export type ScheduleDay = {
  id: Weekday;
  label: string;
  dateLabel: string;
};

export type PeriodInfo = {
  id: string;
  label: string;
  time: string;
  style?: CardStyle;
};

export type CourseCell = {
  id: string;
  title: string;
  room?: string;
  note?: string;
  style?: CardStyle;
  scheduleRule?: CourseScheduleRule;
};

export type ScheduleCourseRow = {
  id: string;
  type: "course";
  period: PeriodInfo;
  courses: Record<Weekday, CourseCell>;
};

export type ScheduleMergedRow = {
  id: string;
  type: "merged";
  period: PeriodInfo;
  title: string;
  subtitle?: string;
  style?: CardStyle;
};

export type ScheduleRow = ScheduleCourseRow | ScheduleMergedRow;

export type ScheduleBlock = {
  id: string;
  title?: string;
  cardTone: "wheat" | "blue";
  style?: CardStyle;
  cardCornerRadius?: number;
  rows: ScheduleRow[];
};

export type Schedule = {
  id: string;
  teacherName: string;
  weekNumber: number;
  termLabel: string;
  activeWeekday: Weekday;
  days: ScheduleDay[];
  blocks: ScheduleBlock[];
};
