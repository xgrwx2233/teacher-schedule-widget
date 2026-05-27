import type { CourseCell, Schedule, ScheduleCourseRow, ScheduleMergedRow, Weekday } from "./types";

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

function row(
  id: string,
  label: string,
  time: string,
  titles: Record<Weekday, string>,
  rooms: Record<Weekday, string>,
): ScheduleCourseRow {
  const courses = weekdayIds.reduce<Record<Weekday, CourseCell>>(
    (result, weekday) => {
      result[weekday] = {
        id: `${id}-${weekday}`,
        title: titles[weekday],
        room: rooms[weekday],
        scheduleRule: {
          weekPattern: "all",
          applyWholeTerm: true,
        },
      };
      return result;
    },
    {} as Record<Weekday, CourseCell>,
  );

  return {
    id,
    type: "course",
    period: { id, label, time },
    courses,
  };
}

function mergedRow(id: string, label: string, time: string, title: string, subtitle: string): ScheduleMergedRow {
  return {
    id,
    type: "merged",
    period: { id, label, time },
    title,
    subtitle,
  };
}

const commonRooms: Record<Weekday, string> = {
  monday: "高一1班",
  tuesday: "高一2班",
  wednesday: "高一3班",
  thursday: "高一4班",
  friday: "高一5班",
  saturday: "选修A",
  sunday: "线上",
};

export const mockSchedule: Schedule = {
  id: "mock-teacher-week",
  teacherName: "林老师",
  weekNumber: 1,
  termLabel: "2026 春季学期",
  activeWeekday: "tuesday",
  days: allScheduleDays.slice(0, 5),
  blocks: [
    {
      id: "morning",
      title: "上午",
      cardTone: "wheat",
      rows: [
        row("p1", "第1节", "08:00-08:45", {
          monday: "语文",
          tuesday: "数学",
          wednesday: "英语",
          thursday: "物理",
          friday: "化学",
          saturday: "阅读",
          sunday: "预习",
        }, commonRooms),
        row("p2", "第2节", "08:55-09:40", {
          monday: "数学",
          tuesday: "英语",
          wednesday: "物理",
          thursday: "化学",
          friday: "语文",
          saturday: "写作",
          sunday: "自习",
        }, commonRooms),
        row("p3", "第3节", "10:10-10:55", {
          monday: "英语",
          tuesday: "物理",
          wednesday: "化学",
          thursday: "语文",
          friday: "数学",
          saturday: "答疑",
          sunday: "备课",
        }, commonRooms),
        row("p4", "第4节", "11:05-11:50", {
          monday: "物理",
          tuesday: "化学",
          wednesday: "语文",
          thursday: "数学",
          friday: "英语",
          saturday: "社团",
          sunday: "休息",
        }, commonRooms),
      ],
    },
    {
      id: "lunch",
      title: "午休",
      cardTone: "blue",
      rows: [mergedRow("lunch", "午休", "12:00-14:00", "午休", "备课 / 休息")],
    },
    {
      id: "afternoon",
      title: "下午",
      cardTone: "blue",
      rows: [
        row("p5", "第5节", "14:30-15:15", {
          monday: "阅读课",
          tuesday: "教研",
          wednesday: "写作",
          thursday: "自习",
          friday: "班会",
          saturday: "拓展",
          sunday: "线上答疑",
        }, {
          ...commonRooms,
          monday: "阅览室",
          tuesday: "语文组",
          saturday: "活动室",
          sunday: "腾讯会议",
        }),
        row("p6", "第6节", "15:25-16:10", {
          monday: "作文评讲",
          tuesday: "公开课",
          wednesday: "社团",
          thursday: "答疑",
          friday: "语文",
          saturday: "竞赛",
          sunday: "休息",
        }, {
          ...commonRooms,
          tuesday: "录播室",
          wednesday: "活动室",
          thursday: "办公室",
        }),
        row("p7", "第7节", "16:20-17:05", {
          monday: "答疑",
          tuesday: "备课",
          wednesday: "阅读课",
          thursday: "作文批改",
          friday: "自习",
          saturday: "自习",
          sunday: "休息",
        }, {
          ...commonRooms,
          monday: "办公室",
          tuesday: "办公室",
          wednesday: "阅览室",
          thursday: "办公室",
        }),
        row("p8", "第8节", "17:15-18:00", {
          monday: "值班",
          tuesday: "家校沟通",
          wednesday: "备课",
          thursday: "社团",
          friday: "周总结",
          saturday: "整理",
          sunday: "休息",
        }, {
          ...commonRooms,
          monday: "年级组",
          tuesday: "办公室",
          wednesday: "办公室",
          thursday: "活动室",
        }),
      ],
    },
  ],
};
