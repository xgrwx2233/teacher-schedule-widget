import type { CSSProperties, PointerEvent, ReactNode, RefObject } from "react";
import type { CardStyle, CourseCell, PeriodInfo, Schedule, Weekday } from "../../features/schedule/types";
import type { SelectedCard, WidgetBackgroundMode } from "../../features/settings/settingsTypes";
import type { WindowMode } from "../../features/windowMode/types";

type ScheduleWidgetProps = {
  schedule: Schedule;
  widgetTitle: string;
  mode: WindowMode;
  menuOpen: boolean;
  hovered: boolean;
  isHeaderCollapsed: boolean;
  activeCellId: string | null;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  widgetStyle?: CSSProperties;
  backgroundMode: WidgetBackgroundMode;
  onToggleHeader: () => void;
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
  isHeaderCollapsed,
  activeCellId,
  menuButtonRef,
  widgetStyle,
  backgroundMode,
  onToggleHeader,
  onToggleMenu,
  onCourseClick,
  onCardEdit,
  onDragStart,
  onResizeStart,
}: ScheduleWidgetProps) {
  const visibleWeekdays = schedule.days.map((day) => day.id);

  return (
    <section className={`schedule-shell mode-${mode} background-${backgroundMode} ${hovered ? "is-forward-hovered" : ""} ${isHeaderCollapsed ? "is-header-collapsed" : ""}`} aria-label={widgetTitle} style={widgetStyle}>
      <div className="schedule-card">
        <div className="schedule-background-overlay" aria-hidden="true" />
        <header className="schedule-toolbar">
          <div className="toolbar-left" aria-label="周次切换">
            <button className="week-arrow-button" type="button" title="前一周">
              &lt;
            </button>
            <button className="week-number-button" type="button" title={schedule.termLabel}>
              第{schedule.weekNumber}周
            </button>
            <button className="week-arrow-button" type="button" title="后一周">
              &gt;
            </button>
          </div>

          <div className="toolbar-drag-zone" onPointerDown={onDragStart} title="拖动窗口" />

          <div className="toolbar-right">
            <button
              ref={menuButtonRef}
              className="hamburger-button"
              data-menu-button="true"
              type="button"
              title="菜单"
              aria-label="菜单"
              aria-expanded={menuOpen}
              onClick={onToggleMenu}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </header>

        <div className="date-row" role="row">
          <div className="date-cell arrow-cell">
            <button
              className="arrow-card header-toggle-button"
              data-header-toggle="true"
              type="button"
              title={isHeaderCollapsed ? "展开顶部栏" : "收起顶部栏"}
              aria-label={isHeaderCollapsed ? "展开顶部栏" : "收起顶部栏"}
              aria-pressed={isHeaderCollapsed}
              onClick={onToggleHeader}
            >
              {isHeaderCollapsed ? "↑" : "↓"}
            </button>
          </div>
          {schedule.days.map((day) => (
            <div className="date-cell" key={day.id}>
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

      {mode === "detached" && <div className="resize-grip" onPointerDown={onResizeStart} title="调整大小" />}
    </section>
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
