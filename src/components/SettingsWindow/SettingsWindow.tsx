import type { PointerEvent } from "react";
import type { WorkdayMode } from "../../features/schedule/types";
import type { SettingsSection, WidgetSettingsState } from "../../features/settings/settingsTypes";

type SettingsWindowProps = {
  open: boolean;
  activeSection: SettingsSection;
  settings: WidgetSettingsState;
  computedWeek: number;
  onActiveSectionChange: (section: SettingsSection) => void;
  onSettingsChange: (settings: WidgetSettingsState) => void;
  onDragStart?: (event: PointerEvent<HTMLElement>) => void;
  onClose: () => void;
};

const sectionItems: Array<{ id: SettingsSection; label: string }> = [
  { id: "workdays", label: "工作日" },
  { id: "term", label: "学期" },
  { id: "blocks", label: "课程块" },
];

const workdayOptions: Array<{ id: WorkdayMode; label: string; description: string }> = [
  { id: "mon-fri", label: "周一到周五", description: "日期栏显示向下箭头 + 周一到周五，共 6 列。" },
  { id: "mon-sat", label: "周一到周六", description: "日期栏显示向下箭头 + 周一到周六，共 7 列。" },
  { id: "mon-sun", label: "周一到周日", description: "日期栏显示向下箭头 + 周一到周日，共 8 列。" },
];

export function SettingsWindow({
  open,
  activeSection,
  settings,
  computedWeek,
  onActiveSectionChange,
  onSettingsChange,
  onDragStart,
  onClose,
}: SettingsWindowProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label="设置">
      <section className="settings-window">
        <header className="settings-header">
          <div className="settings-titlebar" onPointerDown={onDragStart}>
            <div>
              <h2>设置</h2>
              <p>修改后将实时同步到课程表挂件</p>
            </div>
          </div>
          <button className="settings-close-button" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-sidebar" aria-label="设置项">
            {sectionItems.map((item) => (
              <button
                key={item.id}
                className={item.id === activeSection ? "settings-nav-item is-active" : "settings-nav-item"}
                type="button"
                onClick={() => onActiveSectionChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <main className="settings-content">
            {activeSection === "workdays" && (
              <section className="settings-panel-section">
                <h3>工作日</h3>
                <p>控制日期栏显示周一到周五、周一到周六或周一到周日。</p>
                <div className="segmented-list">
                  {workdayOptions.map((option) => (
                    <button
                      key={option.id}
                      className={settings.workdayMode === option.id ? "choice-card is-selected" : "choice-card"}
                      type="button"
                      onClick={() => onSettingsChange({ ...settings, workdayMode: option.id })}
                    >
                      <strong>{option.label}</strong>
                      <span>{option.description}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {activeSection === "term" && (
              <section className="settings-panel-section">
                <h3>学期</h3>
                <p>程序会根据学期起始日期和当前日期自动计算当前周次。</p>
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
            )}

            {activeSection === "blocks" && (
              <section className="settings-panel-section">
                <h3>课程块</h3>
                <p>这一项先保留为后续块编辑器入口，后续会支持增删块、排序和行编辑。</p>
                <div className="design-note-list">
                  <p>建议采用按时间排序的块编辑器，左侧显示块序列，右侧编辑当前块。</p>
                  <p>课程块支持多行课次编辑，占位块固定为单行合并单元格。</p>
                  <p>保存时校验块时间不重叠，并实时刷新到小挂件预览。</p>
                </div>
              </section>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}
