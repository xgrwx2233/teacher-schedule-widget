import type { CSSProperties, PointerEvent, ReactNode, RefObject } from "react";
import { ScheduleToolbar } from "../ScheduleToolbar/ScheduleToolbar";
import type { CardStyle, CourseCell, PeriodInfo, Schedule, Weekday } from "../../features/schedule/types";
import type { SelectedCard, WidgetBackgroundMode } from "../../features/settings/settingsTypes";
import type { WindowMode } from "../../features/windowMode/types";
import type { ToolbarLayoutMode } from "../../features/settings/windowEvents";

type ScheduleWidgetProps = {
  schedule: Schedule;
  widgetTitle: string;
  mode: WindowMode;
  menuOpen: boolean;
  hovered: boolean;
  activeCellId: string | null;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  widgetStyle?: CSSProperties;
  backgroundMode: WidgetBackgroundMode;
  toolbarLayoutMode: ToolbarLayoutMode;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToggleFloatingToolbar: () => void;
  onToggleLayoutMode: () => void;
  onToggleMenu: () => void;
  onCourseClick: (courseId: string) => void;
  onCardEdit: (card: SelectedCard) => void;
  onDragStart: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
};

export function ScheduleWidget({
  schedule,
  widgetTitle,
  mode,
  menuOpen,
  hovered,
  activeCellId,
  menuButtonRef,
  widgetStyle,
  backgroundMode,
  toolbarLayoutMode,
  onPreviousWeek,
  onNextWeek,
  onToggleFloatingToolbar,
  onToggleLayoutMode,
  onToggleMenu,
  onCourseClick,
  onCardEdit,
  onDragStart,
  onResizeStart,
}: ScheduleWidgetProps) {
  const visibleWeekdays = schedule.days.map((day) => day.id);
  const isMinimalistMode = toolbarLayoutMode === "minimalist";

  return (
    <section className={`schedule-shell mode-${mode} background-${backgroundMode} toolbar-${toolbarLayoutMode} ${hovered ? "is-forward-hovered" : ""}`} aria-label={widgetTitle} style={widgetStyle}>
      <div className={`schedule-card ${isMinimalistMode ? "is-minimalist-layout" : ""}`}>
        <div className="schedule-background-overlay" aria-hidden="true" />
        {!isMinimalistMode ? (
          <ScheduleToolbar
            weekNumber={schedule.weekNumber}
            menuOpen={menuOpen}
            toolbarLayoutMode={toolbarLayoutMode}
            menuButtonRef={menuButtonRef}
            onPreviousWeek={onPreviousWeek}
            onNextWeek={onNextWeek}
            onToggleLayoutMode={onToggleLayoutMode}
            onToggleMenu={onToggleMenu}
            onDragStart={onDragStart}
          />
        ) : null}

        <div className="date-row" role="row">
          {isMinimalistMode ? (
            <button
              className="widget-mini-trigger"
              type="button"
              title="打开工具栏"
              aria-label="打开工具栏"
              data-header-toggle="true"
              onClick={onToggleFloatingToolbar}
            >
              <MiniToolbarIcon />
            </button>
          ) : null}
          <div className="date-cell arrow-cell" data-tauri-drag-region={!isMinimalistMode ? "true" : undefined} />
          {schedule.days.map((day) => (
            <div
              className="date-cell"
              key={day.id}
              data-tauri-drag-region={isMinimalistMode ? "true" : undefined}
              onPointerDown={isMinimalistMode ? onDragStart : undefined}
            >
              <div className={`date-card ${day.id === schedule.activeWeekday ? "is-current" : ""}`}>
                <span>{day.label}</span>
                <small>{day.dateLabel}</small>
              </div>
            </div>
          ))}
        </div>

        <div className="schedule-grid" role="table" aria-label="教师课程表">
          <div className="timetable-period-column">
            {schedule.rows.map((row, index) => (
              <ColumnItem key={row.id} variant="period" showRowDivider={index < schedule.rows.length - 1}>
                <PeriodCard period={row.period} onClick={() => onCardEdit({ type: "period", periodId: row.period.id })} />
              </ColumnItem>
            ))}
          </div>

          <div className="schedule-row-cells">
            {schedule.rows.map((row, rowIndex) => (
              <div className={rowIndex < schedule.rows.length - 1 ? "course-row-grid has-row-divider" : "course-row-grid"} key={row.id}>
                {visibleWeekdays.map((weekday, weekdayIndex) => {
                  const course = row.courses[weekday];
                  const endsAtLastColumn = weekdayIndex + 1 >= visibleWeekdays.length;
                  if (!course) {
                    return <ColumnItem key={`${row.id}-${weekday}`} showColumnDivider={!endsAtLastColumn} />;
                  }
                  if (course.mergedInto) {
                    return null;
                  }
                  const span = course.colSpan ?? 1;
                  const courseEndsAtLastColumn = weekdayIndex + span >= visibleWeekdays.length;

                  return (
                    <ColumnItem key={`${row.id}-${weekday}`} span={span} showColumnDivider={!courseEndsAtLastColumn}>
                      <CourseCard course={course} activeCellId={activeCellId} onCourseClick={onCourseClick} onCardEdit={onCardEdit} />
                    </ColumnItem>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {mode === "detached" && (
        <div className="resize-grip" onPointerDown={onResizeStart} title="调整大小" aria-label="调整大小">
        </div>
      )}
    </section>
  );
}

function MiniToolbarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M6 8h12M6 12h12M6 16h12" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M10 5.5h4M8.5 18.5h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity={0.45} />
    </svg>
  );
}

function CourseCard({
  course,
  activeCellId,
  onCourseClick,
  onCardEdit,
}: {
  course: CourseCell;
  activeCellId: string | null;
  onCourseClick: (courseId: string) => void;
  onCardEdit: (card: SelectedCard) => void;
}) {
  return (
    <button
      className={`course-card ${course.id === activeCellId ? "is-active" : ""}`}
      style={toCardCssVars(course.style)}
      data-course-id={course.id}
      type="button"
      title={`${course.title} ${course.room ?? ""}`}
      onClick={() => {
        onCourseClick(course.id);
      }}
      onDoubleClick={() => {
        onCardEdit({ type: "course", courseId: course.id });
      }}
    >
      <span>{course.title}</span>
      {course.room && <small>{course.room}</small>}
    </button>
  );
}

function ColumnItem({
  children = null,
  span = 1,
  variant = "course",
  showRowDivider = false,
  showColumnDivider = false,
}: {
  children?: ReactNode;
  span?: number;
  variant?: "course" | "period";
  showRowDivider?: boolean;
  showColumnDivider?: boolean;
}) {
  const className = [
    "column-item",
    variant === "period" ? "is-period-item" : "is-course-item",
    showRowDivider ? "has-row-divider" : "",
    showColumnDivider ? "has-column-divider" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={className} style={{ gridColumn: span > 1 ? `span ${span}` : undefined }}>
      {children}
    </div>
  );
}

function PeriodCard({ period, onClick }: { period: PeriodInfo; onClick: () => void }) {
  return (
    <button className="period-card" type="button" data-period-id={period.id} style={toCardCssVars(period.style)} onDoubleClick={onClick}>
      <strong>{period.label}</strong>
      <span>{period.time}</span>
    </button>
  );
}

function toCardCssVars(style?: CardStyle): CSSProperties {
  return {
    "--card-bg": style?.backgroundColor,
    "--card-fg": style?.color,
    "--card-font": style?.fontFamily,
    "--card-font-size": style?.fontSize ? `${style.fontSize}px` : undefined,
  } as CSSProperties;
}
