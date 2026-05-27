import type { CSSProperties } from "react";
import type { CardDraft, SelectedCard } from "../../features/settings/settingsTypes";

type CardSettingsWindowProps = {
  selectedCard: SelectedCard | null;
  draft: CardDraft;
  onDraftChange: (draft: CardDraft) => void;
};

export function CardSettingsWindow({ selectedCard, draft, onDraftChange }: CardSettingsWindowProps) {
  if (!selectedCard) {
    return null;
  }

  return (
    <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label="卡片设置">
      <section className="card-settings-window">
        <div className="card-settings-body">
          {selectedCard.type === "course" && <CourseCardSettings draft={draft} onDraftChange={onDraftChange} />}
          {selectedCard.type === "period" && <PeriodCardSettings draft={draft} onDraftChange={onDraftChange} />}
          {selectedCard.type === "placeholder" && <PlaceholderCardSettings draft={draft} onDraftChange={onDraftChange} />}
        </div>
      </section>
    </div>
  );
}

function CourseCardSettings({ draft, onDraftChange }: { draft: CardDraft; onDraftChange: (draft: CardDraft) => void }) {
  return (
    <div className="card-settings-layout">
      <section className="card-settings-preview">
        <div className="preview-card preview-course" style={previewStyle(draft)}>
          <strong>{draft.title || "课程名称"}</strong>
          <span>{draft.secondary || "班级 / 教室"}</span>
        </div>
      </section>
      <section className="card-settings-form">
        <div className="form-grid">
          <label>
            <span>课程名</span>
            <input value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.currentTarget.value })} />
          </label>
          <label>
            <span>班级 / 教室</span>
            <input value={draft.secondary} onChange={(event) => onDraftChange({ ...draft, secondary: event.currentTarget.value })} />
          </label>
          <label>
            <span>背景色</span>
            <input type="color" value={draft.backgroundColor} onChange={(event) => onDraftChange({ ...draft, backgroundColor: event.currentTarget.value })} />
          </label>
          <label>
            <span>字体色</span>
            <input type="color" value={draft.color} onChange={(event) => onDraftChange({ ...draft, color: event.currentTarget.value })} />
          </label>
          <label>
            <span>字体</span>
            <select value={draft.fontFamily} onChange={(event) => onDraftChange({ ...draft, fontFamily: event.currentTarget.value })}>
              <option value="Microsoft YaHei">微软雅黑</option>
              <option value="Segoe UI">Segoe UI</option>
              <option value="SimSun">宋体</option>
              <option value="KaiTi">楷体</option>
            </select>
          </label>
          <label>
            <span>字号</span>
            <input type="number" min="10" max="28" value={draft.fontSize} onChange={(event) => onDraftChange({ ...draft, fontSize: Number(event.currentTarget.value) })} />
          </label>
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
            <input type="checkbox" checked={draft.applyWholeTerm} onChange={(event) => onDraftChange({ ...draft, applyWholeTerm: event.currentTarget.checked })} />
            <span>应用到整个学期</span>
          </label>
        </div>
        {!draft.applyWholeTerm && (
          <div className="term-range-grid">
            <label>
              <span>开始日期</span>
              <input type="date" value={draft.startDate} onChange={(event) => onDraftChange({ ...draft, startDate: event.currentTarget.value })} />
            </label>
            <label>
              <span>结束日期</span>
              <input type="date" value={draft.endDate} onChange={(event) => onDraftChange({ ...draft, endDate: event.currentTarget.value })} />
            </label>
          </div>
        )}
      </section>
    </div>
  );
}

function PeriodCardSettings({ draft, onDraftChange }: { draft: CardDraft; onDraftChange: (draft: CardDraft) => void }) {
  return (
    <div className="card-settings-layout">
      <section className="card-settings-preview">
        <div className="preview-card preview-period" style={previewStyle(draft)}>
          <strong>{draft.title || "第几节"}</strong>
          <span>{draft.secondary || "08:00-08:45"}</span>
        </div>
      </section>
      <section className="card-settings-form">
        <div className="form-grid">
          <label>
            <span>课次名</span>
            <input value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.currentTarget.value })} />
          </label>
          <label>
            <span>起止时间</span>
            <input value={draft.secondary} onChange={(event) => onDraftChange({ ...draft, secondary: event.currentTarget.value })} />
          </label>
          <label>
            <span>背景色</span>
            <input type="color" value={draft.backgroundColor} onChange={(event) => onDraftChange({ ...draft, backgroundColor: event.currentTarget.value })} />
          </label>
          <label>
            <span>字体色</span>
            <input type="color" value={draft.color} onChange={(event) => onDraftChange({ ...draft, color: event.currentTarget.value })} />
          </label>
          <label>
            <span>字体</span>
            <select value={draft.fontFamily} onChange={(event) => onDraftChange({ ...draft, fontFamily: event.currentTarget.value })}>
              <option value="Microsoft YaHei">微软雅黑</option>
              <option value="Segoe UI">Segoe UI</option>
              <option value="SimSun">宋体</option>
              <option value="KaiTi">楷体</option>
            </select>
          </label>
          <label>
            <span>字号</span>
            <input type="number" min="10" max="28" value={draft.fontSize} onChange={(event) => onDraftChange({ ...draft, fontSize: Number(event.currentTarget.value) })} />
          </label>
        </div>
      </section>
    </div>
  );
}

function PlaceholderCardSettings({ draft, onDraftChange }: { draft: CardDraft; onDraftChange: (draft: CardDraft) => void }) {
  return (
    <div className="card-settings-layout">
      <section className="card-settings-preview">
        <div className="preview-card preview-placeholder" style={previewStyle(draft)}>
          <strong>{draft.title || "占位块标题"}</strong>
          <span>{draft.secondary || "说明 / 副标题"}</span>
        </div>
      </section>
      <section className="card-settings-form">
        <div className="form-grid">
          <label>
            <span>标题</span>
            <input value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.currentTarget.value })} />
          </label>
          <label>
            <span>副标题</span>
            <input value={draft.secondary} onChange={(event) => onDraftChange({ ...draft, secondary: event.currentTarget.value })} />
          </label>
          <label>
            <span>背景色</span>
            <input type="color" value={draft.backgroundColor} onChange={(event) => onDraftChange({ ...draft, backgroundColor: event.currentTarget.value })} />
          </label>
          <label>
            <span>字体色</span>
            <input type="color" value={draft.color} onChange={(event) => onDraftChange({ ...draft, color: event.currentTarget.value })} />
          </label>
          <label>
            <span>字体</span>
            <select value={draft.fontFamily} onChange={(event) => onDraftChange({ ...draft, fontFamily: event.currentTarget.value })}>
              <option value="Microsoft YaHei">微软雅黑</option>
              <option value="Segoe UI">Segoe UI</option>
              <option value="SimSun">宋体</option>
              <option value="KaiTi">楷体</option>
            </select>
          </label>
          <label>
            <span>字号</span>
            <input type="number" min="10" max="28" value={draft.fontSize} onChange={(event) => onDraftChange({ ...draft, fontSize: Number(event.currentTarget.value) })} />
          </label>
        </div>
      </section>
    </div>
  );
}

function previewStyle(draft: CardDraft): CSSProperties {
  return {
    "--card-bg": draft.backgroundColor,
    "--card-fg": draft.color,
    "--card-font": draft.fontFamily,
    "--card-font-size": `${draft.fontSize}px`,
  } as CSSProperties;
}
