import { useState, type ReactNode } from "react";
import type { WorkdayMode } from "../../features/schedule/types";
import type {
  AxisColorMode,
  PeriodConfigItem,
  PeriodColumnStyle,
  SettingsSection,
  WidgetSettingsState,
} from "../../features/settings/settingsTypes";
import {
  cardShadowStrengthLabels,
  normalizeAppearanceSettings,
} from "../../features/settings/settingsTypes";
import type { GridLineType } from "../../features/settings/settingsTypes";
import type { WindowMode } from "../../features/windowMode/types";

type SettingsWindowProps = {
  open: boolean;
  activeSection: SettingsSection;
  settings: WidgetSettingsState;
  periods: PeriodConfigItem[];
  computedWeek: number;
  windowMode: WindowMode;
  onActiveSectionChange: (section: SettingsSection) => void;
  onSettingsChange: (settings: WidgetSettingsState) => void;
  onPeriodsChange: (periods: PeriodConfigItem[]) => void;
};

type SettingsIconName = "calendar" | "clock" | "book" | "palette";

const sectionItems: Array<{
  id: SettingsSection;
  label: string;
  icon: SettingsIconName;
}> = [
  { id: "schedule", label: "课程表", icon: "calendar" },
  { id: "periods", label: "课次", icon: "clock" },
  { id: "term", label: "学期", icon: "book" },
  { id: "appearance", label: "外观", icon: "palette" },
];

const workdayOptions: Array<{ id: WorkdayMode; label: string; count: number }> =
  [
    { id: "mon-fri", label: "周一到周五", count: 5 },
    { id: "mon-sat", label: "周一到周六", count: 6 },
    { id: "mon-sun", label: "周一到周日", count: 7 },
  ];

export function SettingsWindow({
  open,
  activeSection,
  settings,
  periods,
  computedWeek,
  windowMode,
  onActiveSectionChange,
  onSettingsChange,
  onPeriodsChange,
}: SettingsWindowProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="settings-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
    >
      <section className="settings-window settings-window-wide">
        <div className="settings-body">
          <nav className="settings-sidebar" aria-label="设置导航">
            {sectionItems.map((item) => (
              <SidebarNavItem
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={item.id === activeSection}
                onClick={() => onActiveSectionChange(item.id)}
              />
            ))}
          </nav>

          <main className="settings-content">
            {activeSection === "schedule" && (
              <ScheduleTablePanel
                settings={settings}
                onSettingsChange={onSettingsChange}
              />
            )}
            {activeSection === "periods" && (
              <PeriodsPanel
                periods={periods}
                onPeriodsChange={onPeriodsChange}
              />
            )}
            {activeSection === "term" && (
              <TermPanel
                settings={settings}
                computedWeek={computedWeek}
                onSettingsChange={onSettingsChange}
              />
            )}
            {activeSection === "appearance" && (
              <AppearancePanel
                settings={settings}
                windowMode={windowMode}
                onSettingsChange={onSettingsChange}
              />
            )}
          </main>
        </div>
      </section>
    </div>
  );
}

function ScheduleTablePanel({
  settings,
  onSettingsChange,
}: {
  settings: WidgetSettingsState;
  onSettingsChange: (settings: WidgetSettingsState) => void;
}) {
  return (
    <section className="settings-panel-section schedule-table-section">
      <div className="schedule-page-head">
        <div className="schedule-page-copy">
          <h3>课程表</h3>
          <p>设置工作日列数，课程表日期栏将实时同步。</p>
        </div>
      </div>

      <div className="schedule-config-grid">
        <section className="schedule-config-card">
          <header>
            <div>
              <h4>工作日</h4>
              <p>控制日期栏的日期格数量。</p>
            </div>
          </header>

          <div
            className="schedule-option-row"
            role="list"
            aria-label="工作日范围"
          >
            {workdayOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={
                  settings.workdayMode === option.id
                    ? "schedule-choice is-selected"
                    : "schedule-choice"
                }
                onClick={() =>
                  onSettingsChange({ ...settings, workdayMode: option.id })
                }
              >
                <strong>{option.label}</strong>
              </button>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function PeriodsPanel({
  periods,
  onPeriodsChange,
}: {
  periods: PeriodConfigItem[];
  onPeriodsChange: (periods: PeriodConfigItem[]) => void;
}) {
  const normalizedPeriods = normalizePeriodItems(periods);

  const updatePeriod = (
    id: string,
    patch: Partial<Pick<PeriodConfigItem, "label" | "time">>,
  ) => {
    onPeriodsChange(
      normalizePeriodItems(
        normalizedPeriods.map((period) =>
          period.id === id ? { ...period, ...patch } : period,
        ),
      ),
    );
  };

  const addPeriod = () => {
    const nextOrder = nextPeriodOrder(normalizedPeriods);
    const previous = normalizedPeriods[normalizedPeriods.length - 1];
    const start = previous ? timeToMinutes(previous.time.split("-")[1]) : 480;
    const end = start + 45;
    onPeriodsChange([
      ...normalizedPeriods,
      {
        id: `p${nextOrder}`,
        label: `第${nextOrder}节`,
        time: `${minutesToTime(start)}-${minutesToTime(end)}`,
      },
    ]);
  };

  const deletePeriod = (id: string) => {
    if (normalizedPeriods.length <= 1) {
      return;
    }
    onPeriodsChange(normalizedPeriods.filter((period) => period.id !== id));
  };

  return (
    <section className="settings-panel-section periods-panel-section">
      <header className="periods-page-header">
        <div>
          <h3>课次</h3>
        </div>
        <button type="button" className="period-add-button" onClick={addPeriod}>
          <Icon name="plus" />
          <span>在最下方添加课次</span>
        </button>
      </header>

      <div className="period-config-list" aria-label="课次配置列表">
        {normalizedPeriods.map((period) => {
          const [startTime, endTime] = splitPeriodTime(period.time);
          return (
            <section className="period-config-row" key={period.id}>
              <label className="period-name-field">
                <span>课次名</span>
                <input
                  type="text"
                  value={period.label}
                  maxLength={12}
                  onChange={(event) =>
                    updatePeriod(period.id, {
                      label: event.currentTarget.value,
                    })
                  }
                />
              </label>
              <label className="period-time-field">
                <span>开始</span>
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) =>
                    updatePeriod(period.id, {
                      time: `${event.currentTarget.value || "00:00"}-${endTime}`,
                    })
                  }
                />
              </label>
              <label className="period-time-field">
                <span>结束</span>
                <input
                  type="time"
                  value={endTime}
                  onChange={(event) =>
                    updatePeriod(period.id, {
                      time: `${startTime}-${event.currentTarget.value || "00:00"}`,
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="period-delete-button"
                aria-label="删除课次"
                disabled={normalizedPeriods.length <= 1}
                onClick={() => deletePeriod(period.id)}
              >
                <Icon name="trash" />
              </button>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function TermPanel({
  settings,
  computedWeek,
  onSettingsChange,
}: {
  settings: WidgetSettingsState;
  computedWeek: number;
  onSettingsChange: (settings: WidgetSettingsState) => void;
}) {
  return (
    <section className="settings-panel-section">
      <h3>学期</h3>
      <p>程序会根据学期起止日期和当前日期自动计算当前周次。</p>
      <div className="form-grid">
        <label>
          <span>开始日期</span>
          <input
            type="date"
            value={settings.term.startDate}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                term: {
                  ...settings.term,
                  startDate: event.currentTarget.value,
                },
              })
            }
          />
        </label>
        <label>
          <span>结束日期</span>
          <input
            type="date"
            value={settings.term.endDate}
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                term: { ...settings.term, endDate: event.currentTarget.value },
              })
            }
          />
        </label>
      </div>
      <div className="settings-note">当前计算周次：第 {computedWeek} 周</div>
    </section>
  );
}

function AppearancePanel({
  settings,
  windowMode,
  onSettingsChange,
}: {
  settings: WidgetSettingsState;
  windowMode: WindowMode;
  onSettingsChange: (settings: WidgetSettingsState) => void;
}) {
  const [expandedSections, setExpandedSections] = useState({
    background: true,
    gridlines: false,
    cards: false,
    axis: false,
  });
  const appearance = normalizeAppearanceSettings(settings.appearance);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  };

  const isBlurMode = appearance.backgroundMode === "blur";
  const allowBlurMode = windowMode === "attached";

  return (
    <section className="settings-panel-section appearance-panel-static">
      <header className="appearance-page-header">
        <h3>外观</h3>
        <p>调整挂件背景、毛玻璃、卡片圆角、阴影与网格线样式。</p>
      </header>

      <div className="appearance-card-stack">
        <AppearanceAccordionCard
          title="窗口背景"
          tooltip="控制挂件窗口本身的背景效果。"
          expanded={expandedSections.background}
          onToggle={() => toggleSection("background")}
        >
          <StaticSettingRow title="背景模式">
            <div
              className="appearance-segmented appearance-segmented-pill"
              aria-label="背景模式"
            >
              <button
                type="button"
                className={
                  appearance.backgroundMode === "solid" ? "is-active" : ""
                }
                onClick={() =>
                  onSettingsChange({
                    ...settings,
                    appearance: { ...appearance, backgroundMode: "solid" },
                  })
                }
              >
                纯色
              </button>
              <button
                type="button"
                className={isBlurMode ? "is-active" : ""}
                disabled={!allowBlurMode}
                onClick={() =>
                  onSettingsChange({
                    ...settings,
                    appearance: { ...appearance, backgroundMode: "blur" },
                  })
                }
              >
                毛玻璃
              </button>
            </div>
          </StaticSettingRow>
          <StaticSettingRow title="背景色">
            <StaticColorPalette
              previewColor={appearance.backgroundColor}
              onPick={(backgroundColor) =>
                onSettingsChange({
                  ...settings,
                  appearance: { ...appearance, backgroundColor },
                })
              }
            />
          </StaticSettingRow>
          <StaticSettingRow title="透明度">
            <StaticSlider
              value={appearance.backgroundOpacity}
              suffix="%"
              onChange={(backgroundOpacity) =>
                onSettingsChange({
                  ...settings,
                  appearance: { ...appearance, backgroundOpacity },
                })
              }
            />
          </StaticSettingRow>
          {isBlurMode && (
            <div className="appearance-fade-section">
              <StaticSettingRow title="模糊强度">
                <StaticSlider
                  value={appearance.blurIntensity}
                  suffix="px"
                  min={0}
                  max={40}
                  onChange={(blurIntensity) =>
                    onSettingsChange({
                      ...settings,
                      appearance: { ...appearance, blurIntensity },
                    })
                  }
                />
              </StaticSettingRow>
              <div className="appearance-card-hint">
                毛玻璃模式建议配合中高透明度使用，以保持文字清晰。
              </div>
            </div>
          )}
        </AppearanceAccordionCard>

        <AppearanceAccordionCard
          title="网格线"
          tooltip="设置课程表水平与垂直分割线的显示效果。"
          expanded={expandedSections.gridlines}
          onToggle={() => toggleSection("gridlines")}
        >
          <StaticSettingRow title="线型">
            <select
              className="appearance-combobox"
              value={appearance.gridLineType}
              aria-label="线型"
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  appearance: {
                    ...appearance,
                    gridLineType: event.currentTarget.value as GridLineType,
                  },
                })
              }
            >
              <option value="none">无</option>
              <option value="solid">实线</option>
              <option value="dashed">虚线</option>
              <option value="dotted">点线</option>
            </select>
          </StaticSettingRow>
          <StaticSettingRow title="线色">
            <StaticColorPalette
              previewColor={appearance.gridLineColor}
              swatches={["#DBE7EF", "#F8FAFC", "#E7E2DB"]}
              onPick={(gridLineColor) =>
                onSettingsChange({
                  ...settings,
                  appearance: { ...appearance, gridLineColor },
                })
              }
            />
          </StaticSettingRow>
          <StaticSettingRow title="粗细">
            <StaticSlider
              value={appearance.gridLineWidth}
              suffix="px"
              min={0.5}
              max={2}
              step={0.5}
              onChange={(gridLineWidth) =>
                onSettingsChange({
                  ...settings,
                  appearance: { ...appearance, gridLineWidth },
                })
              }
            />
          </StaticSettingRow>
          <StaticSettingRow title="透明度">
            <StaticSlider
              value={appearance.gridLineOpacity}
              suffix="%"
              onChange={(gridLineOpacity) =>
                onSettingsChange({
                  ...settings,
                  appearance: { ...appearance, gridLineOpacity },
                })
              }
            />
          </StaticSettingRow>
          <StaticSettingRow title="高级设置">
            <label className="appearance-switch is-disabled">
              <input type="checkbox" readOnly />
              <span>分别设置横线与竖线</span>
              <small>后续支持</small>
            </label>
          </StaticSettingRow>
        </AppearanceAccordionCard>

        <AppearanceAccordionCard
          title="卡片样式"
          tooltip="统一控制课次卡片、课程卡片、日期卡片的圆角与阴影。"
          expanded={expandedSections.cards}
          onToggle={() => toggleSection("cards")}
        >
          <StaticSettingRow title="卡片圆角">
            <StaticSlider
              value={appearance.cardRadius}
              suffix="px"
              min={0}
              max={24}
              onChange={(cardRadius) =>
                onSettingsChange({
                  ...settings,
                  appearance: { ...appearance, cardRadius },
                })
              }
            />
          </StaticSettingRow>
          <StaticSettingRow title="卡片阴影强度">
            <StaticSlider
              value={appearance.cardShadowStrength}
              suffix={` ${cardShadowStrengthLabels[appearance.cardShadowStrength]}`}
              min={0}
              max={4}
              onChange={(cardShadowStrength) =>
                onSettingsChange({
                  ...settings,
                  appearance: { ...appearance, cardShadowStrength },
                })
              }
            />
          </StaticSettingRow>
        </AppearanceAccordionCard>

        <AppearanceAccordionCard
          title="时间日期样式"
          tooltip="提升工具栏、日期栏和时间日期列在复杂背景下的可读性。"
          expanded={expandedSections.axis}
          summary={`${axisColorModeLabels[appearance.axisColorMode]} · ${periodColumnStyleLabels[appearance.periodColumnStyle]}`}
          onToggle={() => toggleSection("axis")}
        >
          <StaticSettingRow title="文字模式">
            <select
              className="appearance-combobox axis-mode-select"
              value={appearance.axisColorMode}
              aria-label="时间日期文字模式"
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  appearance: {
                    ...appearance,
                    axisColorMode: event.currentTarget.value as AxisColorMode,
                  },
                })
              }
            >
              {axisColorModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </StaticSettingRow>
          <StaticSettingRow title="卡片背景色">
            <div
              className="appearance-segmented appearance-segmented-pill axis-period-options"
              aria-label="时间日期背景色"
            >
              {periodColumnStyleOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={
                    appearance.periodColumnStyle === option.value
                      ? "is-active"
                      : ""
                  }
                  onClick={() =>
                    onSettingsChange({
                      ...settings,
                      appearance: {
                        ...appearance,
                        periodColumnStyle: option.value,
                      },
                    })
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </StaticSettingRow>
        </AppearanceAccordionCard>
      </div>
    </section>
  );
}

const axisColorModeOptions: Array<{ value: AxisColorMode; label: string }> = [
  { value: "auto", label: "自动对比" },
  { value: "light", label: "浅色文字" },
  { value: "dark", label: "深色文字" },
];

const axisColorModeLabels: Record<AxisColorMode, string> = {
  auto: "自动对比",
  light: "浅色文字",
  dark: "深色文字",
};

const periodColumnStyleOptions: Array<{
  value: PeriodColumnStyle;
  label: string;
}> = [
  { value: "soft", label: "柔和底卡" },
  { value: "transparent", label: "透明" },
  { value: "solid", label: "实底" },
];

const periodColumnStyleLabels: Record<PeriodColumnStyle, string> = {
  soft: "柔和底卡",
  transparent: "透明",
  solid: "实底",
};

function AppearanceAccordionCard({
  title,
  tooltip,
  summary,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  tooltip: string;
  summary?: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className={
        expanded
          ? "appearance-settings-card is-expanded"
          : "appearance-settings-card"
      }
    >
      <button
        type="button"
        className="appearance-accordion-trigger"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="appearance-card-title">
          <h4>{title}</h4>
          <span
            className="appearance-info-icon"
            title={tooltip}
            aria-label={`${title}说明`}
          >
            ⓘ
          </span>
        </span>
        {!expanded && summary ? (
          <span className="appearance-card-summary">{summary}</span>
        ) : null}
        <span className="appearance-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>
      {expanded && <div className="appearance-setting-list">{children}</div>}
    </section>
  );
}

function StaticSettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="appearance-setting-row">
      <div className="appearance-setting-copy">
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </div>
      <div className="appearance-setting-control">{children}</div>
    </div>
  );
}

function StaticColorPalette({
  previewColor,
  swatches = ["#DBE7EF", "#F8FAFC", "#E7E2DB"],
  onPick,
}: {
  previewColor: string;
  swatches?: string[];
  onPick?: (color: string) => void;
}) {
  return (
    <div className="appearance-color-palette" aria-label="颜色选择">
      {swatches.map((color) => (
        <button
          key={color}
          type="button"
          className="appearance-color-dot"
          aria-label="预设颜色"
          style={{ backgroundColor: color }}
          onClick={() => onPick?.(color)}
        />
      ))}
      {onPick ? (
        <label className="appearance-color-preview" aria-label="自定义颜色">
          <span style={{ backgroundColor: previewColor }} />
          <input
            type="color"
            value={previewColor}
            onChange={(event) => onPick(event.currentTarget.value)}
          />
        </label>
      ) : (
        <button
          type="button"
          className="appearance-color-preview"
          aria-label="自定义颜色"
          style={{ backgroundColor: previewColor }}
        />
      )}
    </div>
  );
}

function StaticSlider({
  value,
  suffix,
  min = 0,
  max = 100,
  step = 1,
  onChange,
}: {
  value: number;
  suffix: string;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
}) {
  return (
    <div className="appearance-static-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange?.(Number(event.currentTarget.value))}
      />
      <strong>
        {step % 1 === 0 ? value : value.toFixed(1)}
        {suffix}
      </strong>
    </div>
  );
}

function SidebarNavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: SettingsIconName;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "settings-nav-item is-active" : "settings-nav-item"}
      onClick={onClick}
    >
      <span className="settings-nav-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span>{label}</span>
    </button>
  );
}

function normalizePeriodItems(periods: PeriodConfigItem[]): PeriodConfigItem[] {
  return periods
    .map((period, index) => {
      const order = periodOrder(period.id) ?? index + 1;
      const [start, end] = splitPeriodTime(period.time);
      return {
        id: period.id || `p${order}`,
        label: period.label || `第${order}节`,
        time: `${start}-${end}`,
      };
    })
    .sort((left, right) => {
      const leftStart = timeToMinutes(left.time.split("-")[0]);
      const rightStart = timeToMinutes(right.time.split("-")[0]);
      if (leftStart !== rightStart) {
        return leftStart - rightStart;
      }
      return (periodOrder(left.id) ?? 0) - (periodOrder(right.id) ?? 0);
    });
}

function nextPeriodOrder(periods: PeriodConfigItem[]): number {
  const maxOrder = periods.reduce(
    (max, period) => Math.max(max, periodOrder(period.id) ?? 0),
    0,
  );
  return maxOrder + 1;
}

function periodOrder(id: string): number | null {
  const match = /^p?(\d+)$/.exec(id.trim());
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function splitPeriodTime(value: string): [string, string] {
  const [start, end] = value.split("-");
  return [normalizeTimeInput(start), normalizeTimeInput(end)];
}

function normalizeTimeInput(value: string | undefined): string {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec((value ?? "").trim());
  if (!match) {
    return "00:00";
  }
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function minutesToTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = normalizeTimeInput(time).split(":").map(Number);
  return hours * 60 + minutes;
}

function Icon({ name }: { name: SettingsIconName | "plus" | "trash" }) {
  switch (name) {
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <rect
            x="4"
            y="5.5"
            width="16"
            height="14"
            rx="3"
            stroke="currentColor"
            strokeWidth="1.9"
          />
          <path
            d="M8 3.5v4M16 3.5v4M4 10h16"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8 13h2M12 13h2M8 16h2M12 16h2"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      );
    case "clock":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <circle
            cx="12"
            cy="12"
            r="8.5"
            stroke="currentColor"
            strokeWidth="1.9"
          />
          <path
            d="M12 7.5v5l3.2 2"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "book":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path
            d="M7 4.5h8.5a3 3 0 0 1 3 3V19H8.5a3 3 0 0 0-3 3V7.5a3 3 0 0 1 1.5-3Z"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <path
            d="M7 4.5a3 3 0 0 0-3 3V19a3 3 0 0 1 3-3h6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "palette":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path
            d="M12 4.5a8 8 0 1 0 0 16h2.2a1.8 1.8 0 0 0 1.8-1.8 1.2 1.2 0 0 1 1.2-1.2H18a3.5 3.5 0 0 0 0-7h-1a1.8 1.8 0 0 1-1.8-1.8A4.2 4.2 0 0 0 12 4.5Z"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          <circle cx="8.2" cy="9" r="0.9" fill="currentColor" stroke="none" />
          <circle
            cx="11.2"
            cy="7.4"
            r="0.9"
            fill="currentColor"
            stroke="none"
          />
          <circle cx="15" cy="8.4" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "plus":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path
            d="M12 5v14M5 12h14"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
        </svg>
      );
    case "trash":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path
            d="M8 8.5v9M12 8.5v9M16 8.5v9"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M5 6.5h14M9 6.5l.8-2h4.4l.8 2M7 6.5l.7 14h8.6l.7-14"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}
