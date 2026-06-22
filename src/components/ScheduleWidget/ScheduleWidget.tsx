import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, PointerEvent, ReactNode, RefObject } from "react";
import { ScheduleToolbar, type ToolbarSyncButtonState } from "../ScheduleToolbar/ScheduleToolbar";
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
  authTitle: string;
  loggedIn: boolean;
  syncButtonState: ToolbarSyncButtonState;
  syncTitle: string;
  canPreviousWeek: boolean;
  canNextWeek: boolean;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToggleFloatingToolbar: () => void;
  onToggleLayoutMode: () => void;
  onOpenAuth: () => void;
  onSync: () => void;
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

type WidgetDensity = "comfortable" | "compact" | "dense";

type WidgetDisplayMetrics = {
  density: WidgetDensity;
  showCourseSubtitle: boolean;
  cssVars: CSSProperties;
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
  authTitle,
  loggedIn,
  syncButtonState,
  syncTitle,
  canPreviousWeek,
  canNextWeek,
  onPreviousWeek,
  onNextWeek,
  onToggleFloatingToolbar,
  onToggleLayoutMode,
  onOpenAuth,
  onSync,
  onToggleMenu,
  onCourseClick,
  onCardEdit,
  onDragStart,
  onResizeStart,
}: ScheduleWidgetProps) {
  const visibleWeekdays = schedule.days.map((day) => day.id);
  const isMinimalistMode = toolbarLayoutMode === "minimalist";
  const verticalOverlays = buildVerticalMergedCourseOverlays(schedule, visibleWeekdays);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const densityMetrics = useWidgetDensityMetrics(
    cardRef,
    schedule.rows.length,
    visibleWeekdays.length,
    isMinimalistMode,
  );

  return (
    <section
      className={`schedule-shell mode-${mode} background-${backgroundMode} toolbar-${toolbarLayoutMode} period-column-${periodColumnStyle} density-${densityMetrics.density} course-subtitle-${densityMetrics.showCourseSubtitle ? "visible" : "hidden"} ${hovered ? "is-forward-hovered" : ""}`}
      aria-label={widgetTitle}
      style={widgetStyle}
    >
      <div
        className={`schedule-card ${isMinimalistMode ? "is-minimalist-layout" : ""}`}
        ref={cardRef}
        style={densityMetrics.cssVars}
      >
        <div className="schedule-background-overlay" key={`wallpaper-${wallpaperVersion}`} aria-hidden="true" />
        {!isMinimalistMode ? (
          <ScheduleToolbar
            weekNumber={schedule.weekNumber}
            menuOpen={menuOpen}
            toolbarLayoutMode={toolbarLayoutMode}
            menuButtonRef={menuButtonRef}
            canPreviousWeek={canPreviousWeek}
            canNextWeek={canNextWeek}
            onPreviousWeek={onPreviousWeek}
            onNextWeek={onNextWeek}
            onToggleLayoutMode={onToggleLayoutMode}
            authLabel={authLabel}
            authTitle={authTitle}
            loggedIn={loggedIn}
            syncButtonState={syncButtonState}
            syncTitle={syncTitle}
            onOpenAuth={onOpenAuth}
            onSync={onSync}
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
                          showSubtitle={densityMetrics.showCourseSubtitle}
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
                  showSubtitle={densityMetrics.showCourseSubtitle}
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

function useWidgetDensityMetrics(
  cardRef: RefObject<HTMLDivElement | null>,
  rowCount: number,
  dayCount: number,
  isMinimalistMode: boolean,
): WidgetDisplayMetrics {
  const [metrics, setMetrics] = useState(() =>
    calculateWidgetDensity(0, 0, rowCount, dayCount, isMinimalistMode),
  );

  useLayoutEffect(() => {
    const element = cardRef.current;
    if (!element) {
      return;
    }

    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = calculateWidgetDensity(
          element.clientWidth,
          element.clientHeight,
          rowCount,
          dayCount,
          isMinimalistMode,
          getComputedStyle(element),
        );
        setMetrics((current) =>
          current.density === next.density &&
          current.cellWidth === next.cellWidth &&
          current.cellHeight === next.cellHeight &&
          current.columnGap === next.columnGap
            ? current
            : next,
        );
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [cardRef, rowCount, dayCount, isMinimalistMode]);

  const minCellEdge = Math.max(1, Math.min(metrics.cellWidth, metrics.cellHeight));
  const cardInset = metrics.density === "dense"
    ? 2
    : metrics.density === "compact"
      ? 4
      : clampNumber(minCellEdge * 0.12, 2, 10);
  const radiusLimit = metrics.density === "dense" ? 4 : metrics.density === "compact" ? 8 : 24;
  const showSecondaryText = metrics.cellHeight >= 52;
  const densityTitleSize = clampNumber(metrics.cellHeight * 0.26, 10, 16);
  const cardTextGap = showSecondaryText ? clampNumber(metrics.cellHeight * 0.08, 2, 12) : 0;
  return {
    density: metrics.density,
    showCourseSubtitle: showSecondaryText,
    cssVars: {
      "--density-card-inset": `${cardInset}px`,
      "--density-card-radius": `${clampNumber(minCellEdge * 0.22, 4, radiusLimit)}px`,
      "--density-title-size": `${densityTitleSize}px`,
      "--density-title-size-boosted": `${densityTitleSize + 3}px`,
      "--density-subtitle-size": `${clampNumber(metrics.cellHeight * 0.18, 7, 11)}px`,
      "--card-text-gap": `${cardTextGap}px`,
      "--schedule-card-shadow": metrics.density === "comfortable" ? undefined : "none",
      "--course-padding-y": `${cardInset}px`,
      "--course-padding-x": `${cardInset}px`,
      "--period-card-row-gap": `${cardTextGap}px`,
      "--column-gap": metrics.density === "dense"
        ? `${Math.min(metrics.columnGap, 4)}px`
        : metrics.density === "compact"
          ? `${Math.min(metrics.columnGap, 8)}px`
          : undefined,
    } as CSSProperties,
  };
}

function calculateWidgetDensity(
  cardWidth: number,
  cardHeight: number,
  rowCount: number,
  dayCount: number,
  isMinimalistMode: boolean,
  sourceStyle?: CSSStyleDeclaration,
): { density: WidgetDensity; cellWidth: number; cellHeight: number; columnGap: number } {
  const widgetStyle = sourceStyle ?? getComputedStyle(document.documentElement);
  const readPx = (name: string, fallback: number) => {
    const value = Number.parseFloat(widgetStyle.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const periodColumnWidth = readPx("--period-column-width", 62);
  const toolbarHeight = readPx("--toolbar-height", 34);
  const dateRowHeight = readPx("--date-row-height", 48);
  const contentPadding = readPx("--content-padding", 14);
  const contentGap = readPx("--content-gap", 12);
  const columnGap = readPx("--column-gap", 10);
  const effectiveRowCount = Math.max(1, rowCount);
  const effectiveDayCount = Math.max(1, dayCount);
  const rowGaps = isMinimalistMode ? 1 : 2;
  const gridWidth = Math.max(1, cardWidth - contentPadding * 2 - periodColumnWidth);
  const gridHeight = Math.max(
    1,
    cardHeight -
      contentPadding * 2 -
      dateRowHeight -
      (isMinimalistMode ? 0 : toolbarHeight) -
      contentGap * rowGaps,
  );
  const cellWidth = Math.round((gridWidth / effectiveDayCount) * 10) / 10;
  const cellHeight = Math.round((gridHeight / effectiveRowCount) * 10) / 10;
  const density: WidgetDensity =
    cellWidth < 72 || cellHeight < 40
      ? "dense"
      : cellWidth < 92 || cellHeight < 52
        ? "compact"
        : "comfortable";

  return { density, cellWidth, cellHeight, columnGap };
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
  showSubtitle,
  activeCellId,
  onCourseClick,
  onCardEdit,
}: {
  course: CourseCell;
  mergedCourseIds: string[];
  mergeAxis: MergeAxis;
  showSubtitle: boolean;
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
      className={`course-card ${showSubtitle ? "is-two-line" : "is-one-line"} ${badgeLabel ? "has-badge" : ""} ${isTemporaryCancel ? "is-temporary-cancel" : ""} ${isActive ? "is-active" : ""}`}
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
    "--course-card-title-size-boosted": courseMetrics ? `${courseMetrics.titleSize + 3}px` : undefined,
    "--course-card-subtitle-size": courseMetrics ? `${courseMetrics.subtitleSize}px` : undefined,
  } as CSSProperties;
}

function toPeriodCardCssVars(style: CardStyle | undefined, periodColumnStyle: PeriodColumnStyle): CSSProperties {
  const cssVars = toCardCssVars(style) as CSSProperties & Record<string, string | undefined>;
  cssVars["--card-bg"] = "var(--period-card-global-bg)";
  cssVars["--card-fg"] = "var(--period-card-global-fg)";
  cssVars["--card-icon"] = "var(--period-card-global-fg)";
  cssVars["--card-font"] = "var(--period-card-global-font)";
  cssVars["--card-font-size"] = "var(--period-card-global-font-size)";

  if (periodColumnStyle === "soft") {
    cssVars["--card-bg"] = "var(--axis-capsule-bg)";
  }

  if (periodColumnStyle === "solid") {
    cssVars["--card-bg"] = "var(--axis-solid-bg)";
  }

  return cssVars;
}
