import type { PointerEvent } from "react";
import type { CardDraft, SelectedCard } from "../../features/settings/settingsTypes";

type CardSettingsWindowProps = {
  selectedCard: SelectedCard | null;
  draft: CardDraft;
  onDraftChange: (draft: CardDraft) => void;
  onDragStart?: (event: PointerEvent<HTMLElement>) => void;
  onClose: () => void;
};

export function CardSettingsWindow({
  selectedCard,
  draft,
  onDraftChange,
  onDragStart,
  onClose,
}: CardSettingsWindowProps) {
  if (!selectedCard) {
    return null;
  }

  const isCourse = selectedCard.type === "course";
  const titleLabel =
    selectedCard.type === "course" ? "课程名" : selectedCard.type === "period" ? "课次名" : "合并卡片标题";
  const secondaryLabel = selectedCard.type === "course" ? "班级 / 教室" : "时间 / 副标题";

  return (
    <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label="卡片设置">
      <section className="card-settings-window">
        <header className="settings-header">
          <div className="settings-titlebar" onPointerDown={onDragStart}>
            <div>
              <h2>卡片设置</h2>
              <p>{isCourse ? "课程卡片" : selectedCard.type === "period" ? "课次卡片" : "合并单元格卡片"}</p>
            </div>
          </div>
          <button className="settings-close-button" type="button" onClick={onClose}>
            X
          </button>
        </header>

        <div className="card-settings-body">
          <div className="form-grid">
            <label>
              <span>{titleLabel}</span>
              <input
                value={draft.title}
                onChange={(event) => onDraftChange({ ...draft, title: event.currentTarget.value })}
              />
            </label>
            <label>
              <span>{secondaryLabel}</span>
              <input
                value={draft.secondary}
                onChange={(event) => onDraftChange({ ...draft, secondary: event.currentTarget.value })}
              />
            </label>
            <label>
              <span>背景色</span>
              <input
                type="color"
                value={draft.backgroundColor}
                onChange={(event) => onDraftChange({ ...draft, backgroundColor: event.currentTarget.value })}
              />
            </label>
            <label>
              <span>字体颜色</span>
              <input
                type="color"
                value={draft.color}
                onChange={(event) => onDraftChange({ ...draft, color: event.currentTarget.value })}
              />
            </label>
            <label>
              <span>字体</span>
              <select
                value={draft.fontFamily}
                onChange={(event) => onDraftChange({ ...draft, fontFamily: event.currentTarget.value })}
              >
                <option value="Microsoft YaHei">微软雅黑</option>
                <option value="Segoe UI">Segoe UI</option>
                <option value="SimSun">宋体</option>
                <option value="KaiTi">楷体</option>
              </select>
            </label>
            <label>
              <span>字号</span>
              <input
                type="number"
                min="10"
                max="24"
                value={draft.fontSize}
                onChange={(event) => onDraftChange({ ...draft, fontSize: Number(event.currentTarget.value) })}
              />
            </label>
          </div>

          {isCourse && (
            <section className="course-rule-panel">
              <h3>上课规则</h3>
              <div className="form-grid">
                <label>
                  <span>单双周</span>
                  <select
                    value={draft.weekPattern}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        weekPattern: event.currentTarget.value as CardDraft["weekPattern"],
                      })
                    }
                  >
                    <option value="all">每周</option>
                    <option value="odd">单周</option>
                    <option value="even">双周</option>
                  </select>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={draft.applyWholeTerm}
                    onChange={(event) => onDraftChange({ ...draft, applyWholeTerm: event.currentTarget.checked })}
                  />
                  <span>应用到整个学期</span>
                </label>
                {!draft.applyWholeTerm && (
                  <>
                    <label>
                      <span>开始日期</span>
                      <input
                        type="date"
                        value={draft.startDate}
                        onChange={(event) => onDraftChange({ ...draft, startDate: event.currentTarget.value })}
                      />
                    </label>
                    <label>
                      <span>结束日期</span>
                      <input
                        type="date"
                        value={draft.endDate}
                        onChange={(event) => onDraftChange({ ...draft, endDate: event.currentTarget.value })}
                      />
                    </label>
                  </>
                )}
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
