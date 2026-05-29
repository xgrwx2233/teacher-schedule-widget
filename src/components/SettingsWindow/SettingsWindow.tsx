import { useState, type ReactNode } from "react";
import type { WorkdayMode } from "../../features/schedule/types";
import type {
  SettingsSection,
  WidgetSettingsState,
} from "../../features/settings/settingsTypes";
import {
  cardShadowStrengthLabels,
  normalizeAppearanceSettings,
} from "../../features/settings/settingsTypes";
import type { GridLineType } from "../../features/settings/settingsTypes";

type SettingsWindowProps = {
  open: boolean;
  activeSection: SettingsSection;
  settings: WidgetSettingsState;
  computedWeek: number;
  onActiveSectionChange: (section: SettingsSection) => void;
  onSettingsChange: (settings: WidgetSettingsState) => void;
};

type SettingsIconName = "calendar" | "book" | "palette";

const sectionItems: Array<{ id: SettingsSection; label: string; icon: SettingsIconName }> = [
  { id: "schedule", label: "课程表", icon: "calendar" },
  { id: "term", label: "学期", icon: "book" },
  { id: "appearance", label: "外观", icon: "palette" },
];

const workdayOptions: Array<{ id: WorkdayMode; label: string; count: number }> = [
  { id: "mon-fri", label: "周一到周五", count: 5 },
  { id: "mon-sat", label: "周一到周六", count: 6 },
  { id: "mon-sun", label: "周一到周日", count: 7 },
];

const weekdayPreview = ["一", "二", "三", "四", "五", "六", "日"];

export function SettingsWindow({
  open,
  activeSection,
  settings,
  computedWeek,
  onActiveSectionChange,
  onSettingsChange,
}: SettingsWindowProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label="设置">
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
            {activeSection === "schedule" && <ScheduleTablePanel settings={settings} onSettingsChange={onSettingsChange} />}
            {activeSection === "term" && <TermPanel settings={settings} computedWeek={computedWeek} onSettingsChange={onSettingsChange} />}
            {activeSection === "appearance" && <AppearancePanel settings={settings} onSettingsChange={onSettingsChange} />}
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
  const periodCount = clampPeriodCount(settings.periodCount);

  return (
    <section className="settings-panel-section schedule-table-section">
      <div className="schedule-page-head">
        <div className="schedule-page-copy">
          <h3>课程表</h3>
          <p>设置工作日列数与每天节数，课程表网格将实时同步。</p>
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

          <div className="schedule-option-row" role="list" aria-label="工作日范围">
            {workdayOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={settings.workdayMode === option.id ? "schedule-choice is-selected" : "schedule-choice"}
                onClick={() => onSettingsChange({ ...settings, workdayMode: option.id })}
              >
                <strong>{option.label}</strong>
                <span className="schedule-choice-preview" aria-hidden="true">
                  {weekdayPreview.slice(0, option.count).map((label) => (
                    <i key={label}>{label}</i>
                  ))}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="schedule-config-card">
          <header>
            <div>
              <h4>节数</h4>
              <p>控制一天有多少节课，即课程表行数。</p>
            </div>
          </header>

          <div className="period-stepper" aria-label="节数控制器">
            <button
              type="button"
              className="period-stepper-button"
              aria-label="减少节数"
              disabled={periodCount <= 4}
              onClick={() => onSettingsChange({ ...settings, periodCount: clampPeriodCount(periodCount - 1) })}
            >
              <span aria-hidden="true">-</span>
            </button>
            <div className="period-stepper-value">
              <strong>{periodCount}</strong>
            </div>
            <span className="period-stepper-unit">节 / 天</span>
            <button
              type="button"
              className="period-stepper-button"
              aria-label="增加节数"
              disabled={periodCount >= 12}
              onClick={() => onSettingsChange({ ...settings, periodCount: clampPeriodCount(periodCount + 1) })}
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
        </section>
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
                term: { ...settings.term, startDate: event.currentTarget.value },
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
  onSettingsChange,
}: {
  settings: WidgetSettingsState;
  onSettingsChange: (settings: WidgetSettingsState) => void;
}) {
  const [expandedSections, setExpandedSections] = useState({
    background: true,
    gridlines: false,
    cards: false,
  });
  const [backgroundMode, setBackgroundMode] = useState<"solid" | "glass">("glass");
  const appearance = normalizeAppearanceSettings(settings.appearance);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }));
  };

  const isGlassMode = backgroundMode === "glass";

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
            <div className="appearance-segmented appearance-segmented-pill" aria-label="背景模式">
              <button type="button" className={backgroundMode === "solid" ? "is-active" : ""} onClick={() => setBackgroundMode("solid")}>
                纯色
              </button>
              <button type="button" className={isGlassMode ? "is-active" : ""} onClick={() => setBackgroundMode("glass")}>
                毛玻璃
              </button>
            </div>
          </StaticSettingRow>
          <StaticSettingRow title="背景色">
            <StaticColorPalette previewColor="#DBE7EF" />
          </StaticSettingRow>
          <StaticSettingRow title="透明度">
            <StaticSlider value={84} suffix="%" />
          </StaticSettingRow>
          {isGlassMode && (
            <div className="appearance-fade-section">
              <StaticSettingRow title="模糊强度">
                <StaticSlider value={14} suffix="px" />
              </StaticSettingRow>
              <div className="appearance-card-hint">毛玻璃模式建议配合中高透明度使用，以保持文字清晰。</div>
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
                  appearance: { ...appearance, gridLineType: event.currentTarget.value as GridLineType },
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
              onChange={(cardRadius) => onSettingsChange({
                ...settings,
                appearance: { ...appearance, cardRadius },
              })}
            />
          </StaticSettingRow>
          <StaticSettingRow title="卡片阴影强度">
            <StaticSlider
              value={appearance.cardShadowStrength}
              suffix={` ${cardShadowStrengthLabels[appearance.cardShadowStrength]}`}
              min={0}
              max={4}
              onChange={(cardShadowStrength) => onSettingsChange({
                ...settings,
                appearance: { ...appearance, cardShadowStrength },
              })}
            />
          </StaticSettingRow>
        </AppearanceAccordionCard>
      </div>
    </section>
  );
}

function AppearanceAccordionCard({
  title,
  tooltip,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  tooltip: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={expanded ? "appearance-settings-card is-expanded" : "appearance-settings-card"}>
      <button type="button" className="appearance-accordion-trigger" aria-expanded={expanded} onClick={onToggle}>
        <span className="appearance-card-title">
          <h4>{title}</h4>
          <span className="appearance-info-icon" title={tooltip} aria-label={`${title}说明`}>
            ⓘ
          </span>
        </span>
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
        <button key={color} type="button" className="appearance-color-dot" aria-label="预设颜色" style={{ backgroundColor: color }} onClick={() => onPick?.(color)} />
      ))}
      {onPick ? (
        <label className="appearance-color-preview" aria-label="自定义颜色">
          <span style={{ backgroundColor: previewColor }} />
          <input type="color" value={previewColor} onChange={(event) => onPick(event.currentTarget.value)} />
        </label>
      ) : (
        <button type="button" className="appearance-color-preview" aria-label="自定义颜色" style={{ backgroundColor: previewColor }} />
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
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange?.(Number(event.currentTarget.value))} />
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
    <button type="button" className={active ? "settings-nav-item is-active" : "settings-nav-item"} onClick={onClick}>
      <span className="settings-nav-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span>{label}</span>
    </button>
  );
}

function clampPeriodCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 8;
  }

  return Math.max(4, Math.min(12, Math.round(value)));
}

function Icon({ name }: { name: SettingsIconName }) {
  switch (name) {
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <rect x="4" y="5.5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.9" />
          <path d="M8 3.5v4M16 3.5v4M4 10h16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 13h2M12 13h2M8 16h2M12 16h2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      );
    case "book":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path d="M7 4.5h8.5a3 3 0 0 1 3 3V19H8.5a3 3 0 0 0-3 3V7.5a3 3 0 0 1 1.5-3Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
          <path d="M7 4.5a3 3 0 0 0-3 3V19a3 3 0 0 1 3-3h6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "palette":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path d="M12 4.5a8 8 0 1 0 0 16h2.2a1.8 1.8 0 0 0 1.8-1.8 1.2 1.2 0 0 1 1.2-1.2H18a3.5 3.5 0 0 0 0-7h-1a1.8 1.8 0 0 1-1.8-1.8A4.2 4.2 0 0 0 12 4.5Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
          <circle cx="8.2" cy="9" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="11.2" cy="7.4" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="15" cy="8.4" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}
