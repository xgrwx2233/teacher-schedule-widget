import type { CSSProperties, PointerEvent, ReactNode, RefObject } from "react";
import type {
  CardStyle,
  PeriodInfo,
  Schedule,
  ScheduleCourseBlock,
  SchedulePlaceholderBlock,
  Weekday,
} from "../../features/schedule/types";
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
  onToggleMenu,
  onCourseClick,
  onCardEdit,
  onDragStart,
  onResizeStart,
}: ScheduleWidgetProps) {
  const visibleWeekdays = schedule.days.map((day) => day.id);

  return (
    <section
      className={`schedule-shell mode-${mode} ${hovered ? "is-forward-hovered" : ""}`}
      aria-label={widgetTitle}
    >
      <div className="schedule-card">
        <header className="schedule-toolbar">
          <div className="toolbar-left" aria-label="周次切换">
            <button className="week-arrow-button" type="button" title="前一周">
              &lt;
            </button>
            <button className="week-number-button" type="button" title={schedule.termLabel}>
              第{schedule.weekNumber}周
            </button>
            <button className="week-arrow-button" type="button" title="下一周">
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
            <div className="arrow-card">⌄</div>
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

        <div className="schedule-blocks" role="table" aria-label="教师课程表">
          {schedule.blocks.map((block) =>
            block.type === "course" ? (
              <CourseBlock
                key={block.id}
                block={block}
                weekdays={visibleWeekdays}
                activeCellId={activeCellId}
                onCourseClick={onCourseClick}
                onCardEdit={onCardEdit}
              />
            ) : (
              <PlaceholderBlock
                key={block.id}
                block={block}
                weekdayCount={visibleWeekdays.length}
                onCardEdit={onCardEdit}
              />
            ),
          )}
        </div>
      </div>

      {mode === "detached" && (
        <div className="resize-grip" onPointerDown={onResizeStart} title="调整大小" />
      )}
    </section>
  );
}

function CourseBlock({
  block,
  weekdays,
  activeCellId,
  onCourseClick,
  onCardEdit,
}: {
  block: ScheduleCourseBlock;
  weekdays: Weekday[];
  activeCellId: string | null;
  onCourseClick: (courseId: string) => void;
  onCardEdit: (card: SelectedCard) => void;
}) {
  const blockStyle = {
    "--block-row-count": block.rows.length,
  } as CSSProperties;

  return (
    <section
      className={`schedule-block course-block ${block.phase}-block tone-${block.cardTone}`}
      style={blockStyle}
    >
      <div className="period-column block-column">
        {block.rows.map((row, index) => (
          <ColumnItem key={row.id} showDivider={index > 0}>
            <PeriodCard period={row.period} onClick={() => onCardEdit({ type: "period", periodId: row.period.id })} />
          </ColumnItem>
        ))}
      </div>

      {weekdays.map((weekday) => (
        <div className="course-column block-column" key={`${block.id}-${weekday}`}>
          {block.rows.map((row, index) => {
            const course = row.courses[weekday];
            return (
              <ColumnItem key={course.id} showDivider={index > 0}>
                <button
                  className={`course-card ${course.id === activeCellId ? "is-active" : ""}`}
                  style={toCardCssVars(course.style)}
                  data-course-id={course.id}
                  type="button"
                  title={`${course.title} ${course.room ?? ""}`}
                  onClick={() => {
                    onCourseClick(course.id);
                    onCardEdit({ type: "course", courseId: course.id });
                  }}
                >
                  <span>{course.title}</span>
                  {course.room && <small>{course.room}</small>}
                </button>
              </ColumnItem>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function PlaceholderBlock({
  block,
  weekdayCount,
  onCardEdit,
}: {
  block: SchedulePlaceholderBlock;
  weekdayCount: number;
  onCardEdit: (card: SelectedCard) => void;
}) {
  return (
    <section className="schedule-block placeholder-block noon-block">
      <div className="period-column block-column">
        <ColumnItem>
          <PeriodCard period={block.period} onClick={() => onCardEdit({ type: "period", periodId: block.period.id })} />
        </ColumnItem>
      </div>
      <div className="merged-cell" style={{ gridColumn: `span ${weekdayCount}` }}>
        <button
          className="merged-card"
          type="button"
          data-placeholder-id={block.id}
          style={toCardCssVars(block.style)}
          onClick={() => onCardEdit({ type: "placeholder", blockId: block.id })}
        >
          <strong>{block.title}</strong>
          {block.subtitle && <span>{block.subtitle}</span>}
        </button>
      </div>
    </section>
  );
}

function ColumnItem({
  children,
  showDivider = false,
}: {
  children: ReactNode;
  showDivider?: boolean;
}) {
  return (
    <div className="column-item">
      {showDivider && <div className="row-divider" aria-hidden="true" />}
      {children}
    </div>
  );
}

function PeriodCard({ period, onClick }: { period: PeriodInfo; onClick: () => void }) {
  return (
    <button
      className="period-card"
      type="button"
      data-period-id={period.id}
      style={toCardCssVars(period.style)}
      onClick={onClick}
    >
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
