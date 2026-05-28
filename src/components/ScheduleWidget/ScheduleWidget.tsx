import type { CSSProperties, PointerEvent, ReactNode, RefObject } from "react";
import type { CardStyle, CourseCell, PeriodInfo, Schedule, Weekday } from "../../features/schedule/types";
import type { SelectedCard } from "../../features/settings/settingsTypes";
import type { WindowMode } from "../../features/windowMode/types";

type ScheduleWidgetProps = {
  schedule: Schedule;
  widgetTitle: string;
  mode: WindowMode;
  menuOpen: boolean;
  hovered: boolean;
  activeCellId: string | null;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  widgetStyle?: CSSProperties;
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
  onToggleMenu,
  onCourseClick,
  onCardEdit,
  onDragStart,
  onResizeStart,
}: ScheduleWidgetProps) {
  const visibleWeekdays = schedule.days.map((day) => day.id);

  return (
    <section className={`schedule-shell mode-${mode} ${hovered ? "is-forward-hovered" : ""}`} aria-label={widgetTitle} style={widgetStyle}>
      <div className="schedule-card">
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
          <div className="date-cell arrow-cell" aria-hidden="true">
            <div className="arrow-card">↓</div>
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
              <ColumnItem key={row.id} showDivider={index > 0}>
                <PeriodCard period={row.period} onClick={() => onCardEdit({ type: "period", periodId: row.period.id })} />
              </ColumnItem>
            ))}
          </div>

          <div className="schedule-row-cells">
            {schedule.rows.map((row, index) => (
              <div className="course-row-grid" key={row.id}>
                {visibleWeekdays.map((weekday) => {
                  const course = row.courses[weekday];
                  if (!course || course.mergedInto) {
                    return null;
                  }

                  return (
                    <ColumnItem key={`${row.id}-${weekday}`} showDivider={index > 0} span={course.colSpan ?? 1}>
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
  children,
  showDivider = false,
  span = 1,
}: {
  children: ReactNode;
  showDivider?: boolean;
  span?: number;
}) {
  return (
    <div className="column-item" style={{ gridColumn: span > 1 ? `span ${span}` : undefined }}>
      {showDivider && <div className="row-divider" aria-hidden="true" />}
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
