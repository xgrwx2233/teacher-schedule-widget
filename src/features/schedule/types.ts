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
  baseColor?: string;
  backgroundColor?: string;
  color?: string;
  iconColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: CourseCardFontWeight;
  displayMode?: CourseCardDisplayMode;
};

export type CourseCardDisplayMode = "auto" | "oneLine" | "twoLine";
export type CourseCardFontWeight = "regular" | "medium" | "bold";

export type CourseScheduleRule = {
  weekPattern: "all" | "odd" | "even";
  applyWholeTerm: boolean;
  startDate?: string;
  endDate?: string;
};

export type CourseTemporaryChange = {
  id: string;
  type: "cancel" | "replace";
  dates: string[];
  title?: string;
  subtitle?: string;
  color?: string;
  replaceTitle?: string;
  replaceSecondary?: string;
  replaceColor?: string;
  style?: CardStyle;
  createdAt?: string;
  updatedAt?: string;
};

export type ScheduleDay = {
  id: Weekday;
  label: string;
  dateLabel: string;
  date?: string;
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
  hidden?: boolean;
  colSpan?: number;
  mergedInto?: string;
  style?: CardStyle;
  scheduleRule?: CourseScheduleRule;
  temporaryChanges?: CourseTemporaryChange[];
  renderBadge?: "temporary" | "odd" | "even";
};

export type ScheduleCourseRow = {
  id: string;
  period: PeriodInfo;
  courses: Record<Weekday, CourseCell>;
};

export type ScheduleRow = ScheduleCourseRow;

export type Schedule = {
  id: string;
  teacherName: string;
  weekNumber: number;
  termLabel: string;
  activeWeekday?: Weekday;
  days: ScheduleDay[];
  rows: ScheduleRow[];
};
