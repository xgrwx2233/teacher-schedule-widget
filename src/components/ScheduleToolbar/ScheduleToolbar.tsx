import type { PointerEvent, ReactNode, RefObject } from "react";
import type { WidgetBackgroundMode } from "../../features/settings/settingsTypes";
import type { ToolbarLayoutMode } from "../../features/settings/windowEvents";

type ScheduleToolbarProps = {
  weekNumber: number;
  menuOpen: boolean;
  toolbarLayoutMode: ToolbarLayoutMode;
  backgroundMode?: WidgetBackgroundMode;
  variant?: "embedded" | "floating";
  menuButtonRef?: RefObject<HTMLButtonElement | null>;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToggleLayoutMode: () => void;
  onToggleMenu: () => void;
  onDragStart?: (event: PointerEvent<HTMLDivElement>) => void;
};

export function ScheduleToolbar({
  weekNumber,
  menuOpen,
  toolbarLayoutMode,
  backgroundMode = "blur",
  variant = "embedded",
  menuButtonRef,
  onPreviousWeek,
  onNextWeek,
  onToggleLayoutMode,
  onToggleMenu,
  onDragStart,
}: ScheduleToolbarProps) {
  const isFloating = variant === "floating";
  const minimalistMode = toolbarLayoutMode === "minimalist";

  return (
    <header
      className={isFloating ? "schedule-toolbar toolbar-floating" : "schedule-toolbar"}
      data-toolbar-variant={variant}
      data-background-mode={backgroundMode}
    >
      <div className="toolbar-left" aria-label="周次切换">
        <ToolbarIconButton title="上一周" ariaLabel="上一周" variant={variant} onClick={onPreviousWeek}>
          <ChevronLeftIcon />
        </ToolbarIconButton>
        <button className="week-number-button" type="button" title={`第${weekNumber}周`} aria-label={`第${weekNumber}周`}>
          第{weekNumber}周
        </button>
        <ToolbarIconButton title="下一周" ariaLabel="下一周" variant={variant} onClick={onNextWeek}>
          <ChevronRightIcon />
        </ToolbarIconButton>
      </div>

      <div
        className={isFloating ? "toolbar-drag-zone toolbar-drag-zone-floating" : "toolbar-drag-zone"}
        data-tauri-drag-region="true"
        onPointerDown={onDragStart}
        aria-hidden="true"
      />

      <div className="toolbar-right">
        <ToolbarIconButton
          transparent
          dataToolbarAction="layout-toggle"
          title={minimalistMode ? "当前极简，点击切换为正常模式" : "当前正常，点击切换为极简模式"}
          ariaLabel={minimalistMode ? "当前极简，点击切换为正常模式" : "当前正常，点击切换为极简模式"}
          variant={variant}
          onClick={onToggleLayoutMode}
        >
          <LayoutToggleIcon minimalist={minimalistMode} />
        </ToolbarIconButton>
        <ToolbarIconButton
          title="菜单"
          ariaLabel="菜单"
          variant={variant}
          active={menuOpen}
          onClick={onToggleMenu}
          buttonRef={menuButtonRef}
          dataMenuButton
        >
          <MenuIcon />
        </ToolbarIconButton>
      </div>
    </header>
  );
}

function ToolbarIconButton({
  children,
  title,
  ariaLabel,
  variant,
  active = false,
  onClick,
  buttonRef,
  dataMenuButton = false,
  dataToolbarAction,
  transparent = false,
}: {
  children: ReactNode;
  title: string;
  ariaLabel: string;
  variant: "embedded" | "floating";
  active?: boolean;
  onClick: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  dataMenuButton?: boolean;
  dataToolbarAction?: "layout-toggle";
  transparent?: boolean;
}) {
  const className = [
    "toolbar-icon-button",
    variant === "floating" ? "is-floating" : "",
    active ? "is-active" : "",
    transparent ? "is-transparent" : "",
  ].filter(Boolean).join(" ");

  return (
    <button
      ref={buttonRef}
      type="button"
      className={className}
      title={title}
      aria-label={ariaLabel}
      aria-expanded={dataMenuButton ? active : undefined}
      data-menu-button={dataMenuButton ? "true" : undefined}
      data-toolbar-action={dataToolbarAction}
      data-tauri-drag-region={undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M14.5 5.5 8.5 12l6 6.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M9.5 5.5 15.5 12l-6 6.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LayoutToggleIcon({ minimalist }: { minimalist: boolean }) {
  if (minimalist) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
        <rect x="5" y="6" width="14" height="12" rx="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 12h8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M10 9h4M10 15h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity={0.35} />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <rect x="4.5" y="5" width="15" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.5 8.5h9M7.5 12h9M7.5 15.5h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
