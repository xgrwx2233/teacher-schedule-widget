import type { CSSProperties, MouseEvent, PointerEvent, ReactNode, RefObject } from "react";
import { ScheduleToolbar } from "../ScheduleToolbar/ScheduleToolbar";
import type { CardStyle, CourseCell, PeriodInfo, Schedule, Weekday } from "../../features/schedule/types";
import type { PeriodColumnStyle, SelectedCard, WidgetBackgroundMode } from "../../features/settings/settingsTypes";
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
  wallpaperVersion: number;
  backgroundMode: WidgetBackgroundMode;
  periodColumnStyle: PeriodColumnStyle;
  toolbarLayoutMode: ToolbarLayoutMode;
  authLabel: string;
  loggedIn: boolean;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToggleFloatingToolbar: () => void;
  onToggleLayoutMode: () => void;
  onOpenAuth: () => void;
  onToggleMenu: () => void;
  onCourseClick: (courseId: string) => void;
  onCardEdit: (card: SelectedCard) => void;
  onDragStart: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
};

type MergeAxis = "horizontal" | "vertical";

type VerticalMergedCourseOverlay = {
  course: CourseCell;
  courseIds: string[];
  rowIndex: number;
  weekdayIndex: number;
  rowSpan: number;
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
  wallpaperVersion,
  backgroundMode,
  periodColumnStyle,
  toolbarLayoutMode,
  authLabel,
  loggedIn,
  onPreviousWeek,
  onNextWeek,
  onToggleFloatingToolbar,
  onToggleLayoutMode,
  onOpenAuth,
  onToggleMenu,
  onCourseClick,
  onCardEdit,
  onDragStart,
  onResizeStart,
}: ScheduleWidgetProps) {
  const visibleWeekdays = schedule.days.map((day) => day.id);
  const isMinimalistMode = toolbarLayoutMode === "minimalist";
  const verticalOverlays = buildVerticalMergedCourseOverlays(schedule, visibleWeekdays);

  return (
    <section className={`schedule-shell mode-${mode} background-${backgroundMode} toolbar-${toolbarLayoutMode} period-column-${periodColumnStyle} ${hovered ? "is-forward-hovered" : ""}`} aria-label={widgetTitle} style={widgetStyle}>
      <div className={`schedule-card ${isMinimalistMode ? "is-minimalist-layout" : ""}`}>
        <div className="schedule-background-overlay" key={`wallpaper-${wallpaperVersion}`} aria-hidden="true" />
        {!isMinimalistMode ? (
          <ScheduleToolbar
            weekNumber={schedule.weekNumber}
            menuOpen={menuOpen}
            toolbarLayoutMode={toolbarLayoutMode}
            menuButtonRef={menuButtonRef}
            onPreviousWeek={onPreviousWeek}
            onNextWeek={onNextWeek}
            onToggleLayoutMode={onToggleLayoutMode}
            authLabel={authLabel}
            loggedIn={loggedIn}
            onOpenAuth={onOpenAuth}
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
                <PeriodCard
                  period={row.period}
                  periodColumnStyle={periodColumnStyle}
                  onClick={() => onCardEdit({ type: "period", periodId: row.period.id })}
                />
              </ColumnItem>
            ))}
          </div>

          <div className="schedule-row-cells">
            {schedule.rows.map((row, rowIndex) => (
              <div className={rowIndex < schedule.rows.length - 1 ? "course-row-grid has-row-divider" : "course-row-grid"} key={row.id}>
                {visibleWeekdays.map((weekday, weekdayIndex) => {
                  const course = row.courses[weekday] ?? null;
                  const endsAtLastColumn = weekdayIndex + 1 >= visibleWeekdays.length;
                  if (course?.mergedInto) {
                    return course.mergeDirection === "vertical"
                      ? <ColumnItem key={`${row.id}-${weekday}`} showColumnDivider={!endsAtLastColumn} />
                      : null;
                  }

                  if (!course) {
                    return <ColumnItem key={`${row.id}-${weekday}`} showColumnDivider={!endsAtLastColumn} />;
                  }

                  if ((course.rowSpan ?? 1) > 1 && course.mergeDirection === "vertical") {
                    return <ColumnItem key={`${row.id}-${weekday}`} showColumnDivider={!endsAtLastColumn} />;
                  }

                  const colSpan = Math.max(1, Math.min(course.colSpan ?? 1, visibleWeekdays.length - weekdayIndex));
                  const courseIds = getHorizontalMergedCourseIds(row.courses, visibleWeekdays, weekdayIndex, colSpan);
                  const courseEndsAtLastColumn = weekdayIndex + colSpan >= visibleWeekdays.length;

                  return (
                    <ColumnItem key={`${row.id}-${weekday}`} span={colSpan} showColumnDivider={!courseEndsAtLastColumn && !endsAtLastColumn}>
                      {course.hidden ? (
                        <button
                          className={`course-card course-card-hidden-hitbox ${course.id === activeCellId ? "is-active" : ""}`}
                          type="button"
                          data-course-id={course.id}
                          aria-label={course.title || "空课程卡片"}
                          onDoubleClick={() => onCardEdit({ type: "course", courseId: course.id })}
                        />
                      ) : (
                        <CourseCard
                          course={course}
                          mergedCourseIds={courseIds}
                          mergeAxis="horizontal"
                          activeCellId={activeCellId}
                          onCourseClick={onCourseClick}
                          onCardEdit={onCardEdit}
                        />
                      )}
                    </ColumnItem>
                  );
                })}
              </div>
            ))}
            {verticalOverlays.map((overlay) => (
              <div
                key={`vertical-${overlay.course.id}`}
                className="vertical-merged-course-overlay"
                style={toVerticalMergedCourseOverlayStyle(overlay, schedule.rows.length, visibleWeekdays.length)}
              >
                <CourseCard
                  course={overlay.course}
                  mergedCourseIds={overlay.courseIds}
                  mergeAxis="vertical"
                  activeCellId={activeCellId}
                  onCourseClick={onCourseClick}
                  onCardEdit={onCardEdit}
                />
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

function getHorizontalMergedCourseIds(
  courses: Partial<Record<Weekday, CourseCell>>,
  visibleWeekdays: Weekday[],
  startIndex: number,
  colSpan: number,
): string[] {
  return visibleWeekdays
    .slice(startIndex, startIndex + colSpan)
    .map((weekday) => courses[weekday]?.id)
    .filter((id): id is string => Boolean(id));
}

function buildVerticalMergedCourseOverlays(schedule: Schedule, visibleWeekdays: Weekday[]): VerticalMergedCourseOverlay[] {
  const overlays: VerticalMergedCourseOverlay[] = [];

  schedule.rows.forEach((row, rowIndex) => {
    visibleWeekdays.forEach((weekday, weekdayIndex) => {
      const course = row.courses[weekday];
      const rowSpan = course?.rowSpan ?? 1;
      if (!course || course.mergedInto || course.mergeDirection !== "vertical" || rowSpan <= 1) {
        return;
      }

      const clampedRowSpan = Math.max(1, Math.min(rowSpan, schedule.rows.length - rowIndex));
      const courseIds = schedule.rows
        .slice(rowIndex, rowIndex + clampedRowSpan)
        .map((item) => item.courses[weekday]?.id)
        .filter((id): id is string => Boolean(id));

      overlays.push({
        course,
        courseIds,
        rowIndex,
        weekdayIndex,
        rowSpan: clampedRowSpan,
      });
    });
  });

  return overlays;
}

function toVerticalMergedCourseOverlayStyle(
  overlay: VerticalMergedCourseOverlay,
  rowCount: number,
  dayCount: number,
): CSSProperties {
  return {
    left: `${(overlay.weekdayIndex / dayCount) * 100}%`,
    top: `${(overlay.rowIndex / rowCount) * 100}%`,
    width: `${100 / dayCount}%`,
    height: `${(overlay.rowSpan / rowCount) * 100}%`,
  };
}

function CourseCard({
  course,
  mergedCourseIds,
  mergeAxis,
  activeCellId,
  onCourseClick,
  onCardEdit,
}: {
  course: CourseCell;
  mergedCourseIds: string[];
  mergeAxis: MergeAxis;
  activeCellId: string | null;
  onCourseClick: (courseId: string) => void;
  onCardEdit: (card: SelectedCard) => void;
}) {
  const displayMetrics = getCourseCardDisplayMetrics(course);
  const badgeLabel = getCourseBadgeLabel(course.renderBadge);
  const resolveCourseIdFromPointer = (event: MouseEvent<HTMLButtonElement>) => {
    if (mergedCourseIds.length <= 1) {
      return course.id;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = mergeAxis === "vertical"
      ? rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0
      : rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const index = Math.max(0, Math.min(mergedCourseIds.length - 1, Math.floor(ratio * mergedCourseIds.length)));
    return mergedCourseIds[index] ?? course.id;
  };
  const isActive = activeCellId ? mergedCourseIds.includes(activeCellId) : false;
  const isTemporaryCancel = course.renderBadge === "temporary" && course.title.trim() === "无课" && !(course.room ?? "").trim();
  return (
    <button
      className={`course-card ${displayMetrics.isTwoLine ? "is-two-line" : "is-one-line"} ${badgeLabel ? "has-badge" : ""} ${isTemporaryCancel ? "is-temporary-cancel" : ""} ${isActive ? "is-active" : ""}`}
      style={toCardCssVars(course.style, displayMetrics)}
      data-course-id={course.id}
      data-course-hit-ids={mergedCourseIds.join(",")}
      data-course-hit-axis={mergeAxis}
      type="button"
      title={`${course.title} ${course.room ?? ""}`}
      onClick={(event) => {
        onCourseClick(resolveCourseIdFromPointer(event));
      }}
      onDoubleClick={(event) => {
        onCardEdit({ type: "course", courseId: resolveCourseIdFromPointer(event) });
      }}
    >
      {badgeLabel ? <span className={`course-card-badge is-${course.renderBadge}`} aria-hidden="true">{badgeLabel}</span> : null}
      <span className="course-card-title-line">
        <span className="course-card-title-text">{course.title}</span>
      </span>
      <small>{course.room ?? ""}</small>
    </button>
  );
}

function getCourseBadgeLabel(badge: CourseCell["renderBadge"]): string {
  if (badge === "temporary") {
    return "临";
  }

  if (badge === "odd") {
    return "单";
  }

  if (badge === "even") {
    return "双";
  }

  return "";
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

function PeriodCard({
  period,
  periodColumnStyle,
  onClick,
}: {
  period: PeriodInfo;
  periodColumnStyle: PeriodColumnStyle;
  onClick: () => void;
}) {
  return (
    <button
      className="period-card"
      type="button"
      data-period-id={period.id}
      style={toPeriodCardCssVars(period.style, periodColumnStyle)}
      onDoubleClick={onClick}
    >
      <strong>{period.label}</strong>
      <span>{period.time}</span>
    </button>
  );
}

type CourseCardDisplayMetrics = {
  isTwoLine: boolean;
  titleSize: number;
  subtitleSize: number;
};

function getCourseCardDisplayMetrics(course: CourseCell): CourseCardDisplayMetrics {
  const baseFontSize = clampNumber(course.style?.fontSize ?? 14, 8, 16);
  const titleSize = clampNumber(baseFontSize, 8, 16);
  const subtitleSize = clampNumber(roundToHalf(baseFontSize * 0.68), 7, 11);

  return {
    isTwoLine: true,
    titleSize,
    subtitleSize,
  };
}

function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function toCardCssVars(style?: CardStyle, courseMetrics?: CourseCardDisplayMetrics): CSSProperties {
  const titleFontWeight =
    style?.fontWeight === "bold" ? "800" : style?.fontWeight === "regular" ? "400" : "600";
  const subtitleFontWeight =
    style?.fontWeight === "bold" ? "600" : style?.fontWeight === "regular" ? "400" : "400";

  return {
    "--card-bg": style?.backgroundColor,
    "--card-fg": style?.color,
    "--card-icon": style?.iconColor ?? style?.color,
    "--card-font": style?.fontFamily,
    "--card-font-weight": titleFontWeight,
    "--card-subtitle-font-weight": subtitleFontWeight,
    "--card-font-size": style?.fontSize ? `${style.fontSize}px` : undefined,
    "--course-card-title-size": courseMetrics ? `${courseMetrics.titleSize}px` : undefined,
    "--course-card-subtitle-size": courseMetrics ? `${courseMetrics.subtitleSize}px` : undefined,
  } as CSSProperties;
}

function toPeriodCardCssVars(style: CardStyle | undefined, periodColumnStyle: PeriodColumnStyle): CSSProperties {
  const cssVars = toCardCssVars(style) as CSSProperties & Record<string, string | undefined>;
  const baseColor = style?.baseColor ?? style?.backgroundColor;
  cssVars["--card-font-size"] = style?.fontSize ? `${clampNumber(style.fontSize, 8, 16)}px` : undefined;

  if (!baseColor) {
    return cssVars;
  }

  if (periodColumnStyle === "soft") {
    cssVars["--card-bg"] = buildSoftPeriodBackground(baseColor);
  }

  if (periodColumnStyle === "solid") {
    cssVars["--card-bg"] = baseColor;
  }

  return cssVars;
}

function buildSoftPeriodBackground(value: string): string {
  const rgb = parseHexColor(value);
  if (!rgb) {
    return value;
  }

  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`;
}

function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const normalized = value.trim().replace(/^#/, "");
  const expanded = normalized.length === 3 ? normalized.split("").map((item) => item + item).join("") : normalized;
  const match = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expanded);
  if (!match) {
    return null;
  }

  return {
    r: Number.parseInt(match[1], 16),
    g: Number.parseInt(match[2], 16),
    b: Number.parseInt(match[3], 16),
  };
}
