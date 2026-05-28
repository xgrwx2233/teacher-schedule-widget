import type { WorkdayMode } from "../../features/schedule/types";
import type {
  AppearanceSettings,
  SettingsSection,
  WidgetSettingsState,
} from "../../features/settings/settingsTypes";

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
  const appearance = settings.appearance;
  const updateAppearance = (patch: Partial<AppearanceSettings>) => {
    onSettingsChange({ ...settings, appearance: { ...appearance, ...patch } });
  };

  return (
    <section className="settings-panel-section">
      <h3>外观</h3>
      <p>控制列间距、行间距与网格分割线外观。</p>
      <div className="appearance-grid">
        <RangeField label="列间距" min={4} max={20} value={appearance.columnGap} suffix="px" onChange={(columnGap) => updateAppearance({ columnGap })} />
        <RangeField label="行间距" min={0} max={8} value={appearance.rowDividerHeight} suffix="px" onChange={(rowDividerHeight) => updateAppearance({ rowDividerHeight })} />
        <label className="appearance-field">
          <span>线型</span>
          <select value={appearance.rowDividerStyle} onChange={(event) => updateAppearance({ rowDividerStyle: event.currentTarget.value as AppearanceSettings["rowDividerStyle"] })}>
            <option value="solid">实线</option>
            <option value="dashed">虚线</option>
            <option value="dotted">点线</option>
          </select>
        </label>
        <label className="appearance-field">
          <span>线色</span>
          <input type="color" value={appearance.rowDividerColor} onChange={(event) => updateAppearance({ rowDividerColor: event.currentTarget.value })} />
        </label>
        <RangeField label="透明度" min={0} max={100} value={Math.round(appearance.rowDividerOpacity * 100)} suffix="%" onChange={(value) => updateAppearance({ rowDividerOpacity: value / 100 })} />
        <RangeField label="粗细" min={1} max={3} step={0.5} value={appearance.rowDividerThickness} suffix="px" onChange={(rowDividerThickness) => updateAppearance({ rowDividerThickness })} />
      </div>
    </section>
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

function RangeField({
  label,
  min,
  max,
  step = 1,
  value,
  suffix,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="appearance-field">
      <span>{label}</span>
      <div className="appearance-control">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} />
        <strong>
          {value}
          {suffix}
        </strong>
      </div>
    </label>
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
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5.5" width="16" height="14" rx="3" />
          <path d="M8 3.5v4M16 3.5v4M4 10h16" />
          <path d="M8 13h2M12 13h2M8 16h2M12 16h2" />
        </svg>
      );
    case "book":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 4.5h9a3 3 0 0 1 3 3v12H9a3 3 0 0 0-3 3V4.5Z" />
          <path d="M6 4.5a3 3 0 0 0-3 3v12a3 3 0 0 1 3-3h6" />
        </svg>
      );
    case "palette":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4.5a8 8 0 1 0 0 16h2.2a1.8 1.8 0 0 0 1.8-1.8 1.2 1.2 0 0 1 1.2-1.2H18a3.5 3.5 0 0 0 0-7h-1a1.8 1.8 0 0 1-1.8-1.8A4.2 4.2 0 0 0 12 4.5Z" />
          <circle cx="8.2" cy="9" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="11.2" cy="7.4" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="15" cy="8.4" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}
