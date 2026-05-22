import type { SettingsSection, WidgetSettingsState } from "../../features/settings/settingsTypes";
import type { WorkdayMode } from "../../features/schedule/types";
import type { PointerEvent } from "react";

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
  { id: "mon-fri", label: "周一到周五", description: "向下箭头 + 5 天，共 6 列" },
  { id: "mon-sat", label: "周一到周六", description: "向下箭头 + 6 天，共 7 列" },
  { id: "mon-sun", label: "周一到周日", description: "向下箭头 + 7 天，共 8 列" },
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
              <p>修改后立即更新课程表挂件</p>
            </div>
          </div>
          <button className="settings-close-button" type="button" onClick={onClose}>
            X
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
                <p>选择日期栏显示的工作日范围。课程表列会同步增减并保持对齐。</p>
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
                <p>程序会根据学期开始日期和当前日期计算当前周次。</p>
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
                <div className="settings-note">当前计算周次：第{computedWeek}周</div>
              </section>
            )}

            {activeSection === "blocks" && (
              <section className="settings-panel-section">
                <h3>课程块</h3>
                <p>本项先提供设计建议，复杂编辑器后续单独开发。</p>
                <div className="design-note-list">
                  <p>建议用“时间轴 + 块卡片”的结构：左侧显示块顺序，右侧编辑选中块。</p>
                  <p>新增块时先选择课程块或占位块，再填写起止时间；保存前检测时间重叠。</p>
                  <p>课程块内部用行列表管理课次，每行可编辑课次名、开始时间、结束时间并可删除。</p>
                  <p>占位块固定一行，编辑左侧课次卡片和右侧合并卡片内容。</p>
                  <p>排序建议按开始时间自动排序，不建议自由拖拽破坏时间顺序。</p>
                </div>
              </section>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}
