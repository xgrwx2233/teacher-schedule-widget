import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CardDraft,
  CourseCardMergeState,
  SelectedCard,
  TemporaryChangeDraft,
} from "../../features/settings/settingsTypes";
import { courseCardPresetColors } from "../../features/settings/settingsTypes";

type CardSettingsWindowProps = {
  selectedCard: SelectedCard | null;
  draft: CardDraft;
  mergeState: CourseCardMergeState;
  term: { startDate: string; endDate: string };
  temporaryChanges: TemporaryChangeDraft[];
  activeTemporaryChangeId: string | null;
  onDraftChange: (draft: CardDraft) => void;
  onMergeRight: () => void;
  onSplit: () => void;
  onDeleteCourse: () => void;
  onAddCourse: () => void;
  onGlobalStyleApply: () => void;
  onGlobalScheduleApply: () => void;
  onTemporaryChangeSelect: (id: string | null) => void;
  onTemporaryChangeUpdate: (change: TemporaryChangeDraft) => void;
  onTemporaryChangeRemove: (id: string) => void;
};

type CardSettingsTab = "course" | "temporary";

const courseFontSizeOptions = Array.from({ length: 9 }, (_, index) => index + 8);
const periodFontSizeOptions = Array.from({ length: 15 }, (_, index) => index + 10);
const todayIso = new Date().toISOString().slice(0, 10);

export function CardSettingsWindow({
  selectedCard,
  draft,
  mergeState,
  term,
  temporaryChanges,
  activeTemporaryChangeId,
  onDraftChange,
  onMergeRight,
  onSplit,
  onDeleteCourse,
  onAddCourse,
  onGlobalStyleApply,
  onGlobalScheduleApply,
  onTemporaryChangeSelect,
  onTemporaryChangeUpdate,
  onTemporaryChangeRemove,
}: CardSettingsWindowProps) {
  const [activeTab, setActiveTab] = useState<CardSettingsTab>("course");
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeTab, selectedCard]);

  if (!selectedCard) {
    return null;
  }

  return (
    <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label="课程卡片设置">
      <section className="card-settings-window">
        <nav className="card-settings-tabs" aria-label="卡片设置分类">
          <button type="button" className={activeTab === "course" ? "is-active" : ""} onClick={() => setActiveTab("course")}>
            课程配置
          </button>
          <button type="button" className={activeTab === "temporary" ? "is-active" : ""} onClick={() => setActiveTab("temporary")}>
            临时改动
          </button>
        </nav>

        <div className={activeTab === "temporary" ? "card-settings-body is-temporary-tab" : "card-settings-body"} ref={bodyRef}>
          {activeTab === "course" ? (
            selectedCard.type === "course" ? (
              <CourseConfigurationTab draft={draft} term={term} mergeState={mergeState} onDraftChange={onDraftChange} onMergeRight={onMergeRight} onSplit={onSplit} onDeleteCourse={onDeleteCourse} onAddCourse={onAddCourse} onGlobalStyleApply={onGlobalStyleApply} onGlobalScheduleApply={onGlobalScheduleApply} />
            ) : (
              <PeriodConfigurationTab draft={draft} onDraftChange={onDraftChange} />
            )
          ) : (
            <TemporaryChangesTab
              changes={temporaryChanges}
              activeChangeId={activeTemporaryChangeId}
              onSelectChange={onTemporaryChangeSelect}
              onUpdateChange={onTemporaryChangeUpdate}
              onRemoveChange={onTemporaryChangeRemove}
            />
          )}
        </div>

      </section>
    </div>
  );
}

function CourseConfigurationTab({
  draft,
  term,
  mergeState,
  onDraftChange,
  onMergeRight,
  onSplit,
  onDeleteCourse,
  onAddCourse,
  onGlobalStyleApply,
  onGlobalScheduleApply,
}: {
  draft: CardDraft;
  term: { startDate: string; endDate: string };
  mergeState: CourseCardMergeState;
  onDraftChange: (draft: CardDraft) => void;
  onMergeRight: () => void;
  onSplit: () => void;
  onDeleteCourse: () => void;
  onAddCourse: () => void;
  onGlobalStyleApply: () => void;
  onGlobalScheduleApply: () => void;
}) {
  return (
    <div className="course-config-stack">
      <SettingsCard>
        <div className="basic-info-grid">
          <div className="basic-info-inline">
            <label className="basic-info-field">
              <span>课程名</span>
              <input
                className="card-settings-input"
                value={draft.title}
                maxLength={4}
                placeholder="社团"
                onChange={(event) => onDraftChange({ ...draft, title: limitCardText(event.currentTarget.value) })}
              />
            </label>
            <label className="basic-info-field">
              <span>辅助信息</span>
              <input
                className="card-settings-input"
                value={draft.secondary}
                maxLength={4}
                placeholder="活动室"
                onChange={(event) => onDraftChange({ ...draft, secondary: limitCardText(event.currentTarget.value) })}
              />
            </label>
          </div>
          <div className="basic-info-color">
            <span>颜色</span>
            <ColorPickerRow value={draft.backgroundColor} onChange={(backgroundColor) => onDraftChange({ ...draft, backgroundColor })} />
          </div>
        </div>
      </SettingsCard>

      <div className="accordion-group">
        <details className="row-card row-card-accordion accordion-style">
          <summary>
            <span className="row-card-label">风格</span>
              <span className="card-settings-accordion-chevron" aria-hidden="true">
                ▾
              </span>
          </summary>
          <div className="row-card-accordion-content">
            <div className="style-row-stack">
              <div className="style-row-grid">
                <CompactField label="字体">
                  <select className="card-settings-select" value={draft.fontFamily} onChange={(event) => onDraftChange({ ...draft, fontFamily: event.currentTarget.value })}>
                    <option value="Microsoft YaHei">微软雅黑</option>
                    <option value="Segoe UI">Segoe UI</option>
                    <option value="SimSun">宋体</option>
                    <option value="KaiTi">楷体</option>
                  </select>
                </CompactField>
                <CompactField label="字号">
                  <select className="card-settings-select" value={draft.fontSize} onChange={(event) => onDraftChange({ ...draft, fontSize: clamp(Number(event.currentTarget.value), 8, 16) })}>
                    {courseFontSizeOptions.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </CompactField>
                <CompactField label="粗细">
                  <select className="card-settings-select" value={draft.fontWeight} onChange={(event) => onDraftChange({ ...draft, fontWeight: event.currentTarget.value as CardDraft["fontWeight"] })}>
                    <option value="regular">常规</option>
                    <option value="medium">中等</option>
                    <option value="bold">加粗</option>
                  </select>
                </CompactField>
              </div>
          <div className="style-row-secondary">
            <div className="card-settings-field display-mode-control">
              <select
                className="card-settings-select card-settings-select-narrow display-mode-select"
                value={draft.displayMode}
                onChange={(event) => onDraftChange({ ...draft, displayMode: event.currentTarget.value as typeof draft.displayMode })}
              >
                    <option value="auto" title="有辅助信息时自动显示双行，没有辅助信息时显示单行">
                      自动
                    </option>
                    <option value="oneLine" title="只显示一行课程名">
                      单行
                    </option>
                    <option value="twoLine" title="有辅助信息时固定双行，没有辅助信息时自动退回单行">
                      双行
                    </option>
                  </select>
                </div>
                <button type="button" className="card-settings-secondary action-global-apply" onClick={onGlobalStyleApply}>
                  全局应用
                </button>
              </div>
            </div>
          </div>
        </details>

        <details className="row-card row-card-accordion accordion-date">
          <summary>
            <span className="row-card-label">排课日期</span>
              <span className="card-settings-accordion-chevron" aria-hidden="true">
                ▾
              </span>
          </summary>
          <div className="row-card-accordion-content">
            <div className="schedule-row-top">
              <DatePickerField
                label="开始日期"
                value={draft.startDate}
                onChange={(startDate) => onDraftChange({ ...draft, applyWholeTerm: false, startDate })}
              />
              <DatePickerField
                label="结束日期"
                value={draft.endDate}
                onChange={(endDate) => onDraftChange({ ...draft, applyWholeTerm: false, endDate })}
              />
            </div>
            <div className="schedule-row-bottom">
              <select
                className="card-settings-select compact-select schedule-pattern-select"
                value={draft.weekPattern}
                onChange={(event) => onDraftChange({ ...draft, weekPattern: event.currentTarget.value as CardDraft["weekPattern"] })}
              >
                <option value="all">每周</option>
                <option value="odd">单周</option>
                <option value="even">双周</option>
              </select>
              <button type="button" className="icon-chip-button" title="使用学期起止日期" aria-label="使用学期起止日期" onClick={() => onDraftChange({ ...draft, applyWholeTerm: true, startDate: term.startDate, endDate: term.endDate })}>
                <CalendarIcon />
              </button>
              <button type="button" className="card-settings-secondary action-global-apply schedule-global-apply" onClick={onGlobalScheduleApply}>
                全局应用
              </button>
            </div>
          </div>
        </details>

        <details className="row-card row-card-accordion accordion-merge">
          <summary>
            <span className="row-card-label">合并 / 拆分</span>
              <span className="card-settings-accordion-chevron" aria-hidden="true">
                ▾
              </span>
          </summary>
          <div className="row-card-accordion-content">
            <div className="merge-panel">
              <div className="merge-dpad" aria-label="合并方向">
                <button type="button" disabled>
                  上合并
                </button>
                <button type="button" disabled>
                  左合并
                </button>
                <button type="button" disabled={!mergeState.canMergeRight} onClick={onMergeRight}>
                  右合并
                </button>
                <button type="button" disabled>
                  下合并
                </button>
              </div>
              <button className="split-card-button" type="button" disabled={!mergeState.canSplit} onClick={onSplit}>
                拆分
              </button>
            </div>
          </div>
        </details>
      </div>
      <div className="course-config-footer">
        <button type="button" className="card-settings-footer-action card-settings-danger" onClick={onDeleteCourse}>
          删除
        </button>
        <button type="button" className="card-settings-footer-action card-settings-add" onClick={onAddCourse}>
          添加
        </button>
      </div>
    </div>
  );
}

function PeriodConfigurationTab({ draft, onDraftChange }: { draft: CardDraft; onDraftChange: (draft: CardDraft) => void }) {
  return (
    <div className="course-config-stack period-config-grid">
      <SettingsCard title="基础信息">
        <div className="basic-inline-inputs">
          <label>
            <span>课次</span>
            <input className="card-settings-input" value={draft.title} maxLength={4} placeholder="课次" onChange={(event) => onDraftChange({ ...draft, title: limitCardText(event.currentTarget.value) })} />
          </label>
          <label>
            <span>时间</span>
            <input className="card-settings-input" value={draft.secondary} maxLength={4} placeholder="时间" onChange={(event) => onDraftChange({ ...draft, secondary: limitCardText(event.currentTarget.value) })} />
          </label>
        </div>
        <SettingRow label="颜色">
        <ColorPickerRow value={draft.backgroundColor} onChange={(backgroundColor) => onDraftChange({ ...draft, backgroundColor })} />
        </SettingRow>
        <div className="typography-matrix">
          <label>
            <span>字体</span>
            <select className="card-settings-select" value={draft.fontFamily} onChange={(event) => onDraftChange({ ...draft, fontFamily: event.currentTarget.value })}>
              <option value="Microsoft YaHei">微软雅黑</option>
              <option value="Segoe UI">Segoe UI</option>
              <option value="SimSun">宋体</option>
              <option value="KaiTi">楷体</option>
            </select>
          </label>
          <label>
            <span>字号</span>
            <select className="card-settings-select" value={draft.fontSize} onChange={(event) => onDraftChange({ ...draft, fontSize: clamp(Number(event.currentTarget.value), 10, 24) })}>
              {periodFontSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </SettingsCard>
    </div>
  );
}

function TemporaryChangesTab({
  changes,
  activeChangeId,
  onSelectChange,
  onUpdateChange,
  onRemoveChange,
}: {
  changes: TemporaryChangeDraft[];
  activeChangeId: string | null;
  onSelectChange: (id: string | null) => void;
  onUpdateChange: (change: TemporaryChangeDraft) => void;
  onRemoveChange: (id: string) => void;
}) {
  const sortedChanges = useMemo(() => [...changes].sort(sortTemporaryChangesByUpdatedAt), [changes]);
  const activeChange = sortedChanges.find((change) => change.id === activeChangeId) ?? null;
  const [editor, setEditor] = useState<TemporaryChangeDraft>(() => createEditableTemporaryChange(activeChange));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [replaceConfirmChange, setReplaceConfirmChange] = useState<TemporaryChangeDraft | null>(null);

  useEffect(() => {
    setEditor(createEditableTemporaryChange(activeChange));
    setFeedback("");
  }, [activeChange]);

  const updateEditor = (patch: Partial<TemporaryChangeDraft>) => {
    setEditor((current) => ({
      ...current,
      ...patch,
      replaceTitle: patch.title ?? patch.replaceTitle ?? current.replaceTitle,
      replaceSecondary: patch.subtitle ?? patch.replaceSecondary ?? current.replaceSecondary,
      replaceColor: patch.color ?? patch.replaceColor ?? current.replaceColor,
    }));
  };

  const markNoClass = () => {
    updateEditor({
      type: "cancel",
      title: "无课",
      subtitle: "",
    });
  };

  const isNoClass = editor.title.trim() === "无课";

  const removeDate = (date: string) => {
    const nextDates = editor.dates.filter((item) => item !== date);
    if (nextDates.length === 0) {
      onRemoveChange(editor.id);
      onSelectChange(null);
      setEditor(createEditableTemporaryChange(null));
      setFeedback("");
      return;
    }

    updateEditor({ dates: nextDates });
  };

  const saveChange = (forceReplace = false) => {
    const normalized = normalizeTemporaryEditor(editor);
    if (!normalized.title.trim()) {
      setFeedback("请先填写课程名");
      return;
    }

    if (normalized.dates.length === 0) {
      setFeedback("请至少选择一个改动日期");
      return;
    }

    const anotherEffective = changes.find((change) => change.id !== normalized.id && isEffectiveTemporaryChange(change));
    if (!forceReplace && isEffectiveTemporaryChange(normalized) && anotherEffective) {
      setReplaceConfirmChange(normalized);
      return;
    }

    if (forceReplace) {
      changes
        .filter((change) => change.id !== normalized.id && isEffectiveTemporaryChange(change))
        .forEach((change) => onRemoveChange(change.id));
    }

    onUpdateChange(normalized);
    onSelectChange(normalized.id);
    setEditor(normalized);
    setReplaceConfirmChange(null);
    setFeedback("已保存");
  };

  const deleteHistory = () => {
    if (!activeChange) {
      return;
    }

    if (!window.confirm("是否删除该条临时改动历史？")) {
      return;
    }

    onRemoveChange(activeChange.id);
    setEditor(createEditableTemporaryChange(null));
    setFeedback("");
  };

  return (
    <div className="temporary-config-stack">
      <SettingsCard>
        <div className="basic-info-grid">
          <div className="basic-info-inline">
            <label className={isNoClass ? "basic-info-field is-disabled" : "basic-info-field"}>
              <div className="basic-info-field-head">
                <span>课程名</span>
                <button
                  type="button"
                  className={isNoClass ? "temporary-no-class-button is-active" : "temporary-no-class-button"}
                  onClick={markNoClass}
                >
                  不上啦
                </button>
              </div>
              <input
                className="card-settings-input"
                value={editor.title}
                maxLength={4}
                placeholder="社团"
                disabled={isNoClass}
                onChange={(event) => updateEditor({ title: limitCardText(event.currentTarget.value) })}
              />
            </label>
            <label className={isNoClass ? "basic-info-field is-disabled" : "basic-info-field"}>
              <span>辅助信息</span>
              <input
                className="card-settings-input"
                value={editor.subtitle}
                maxLength={4}
                placeholder="活动室"
                disabled={isNoClass}
                onChange={(event) => updateEditor({ subtitle: limitCardText(event.currentTarget.value) })}
              />
            </label>
          </div>
          <div className="basic-info-color">
            <span>颜色</span>
            <ColorPickerRow value={editor.color} onChange={(color) => updateEditor({ color })} />
          </div>
        </div>
      </SettingsCard>

      <div className="accordion-group temporary-style-group">
        <details className="row-card row-card-accordion accordion-style">
          <summary>
            <span className="row-card-label">风格</span>
            <span className="card-settings-accordion-chevron" aria-hidden="true">
              ▾
            </span>
          </summary>
          <div className="row-card-accordion-content">
            <div className="style-row-stack">
              <div className="style-row-grid">
                <CompactField label="字体">
                  <select className="card-settings-select" value={editor.style.fontFamily} onChange={(event) => updateEditor({ style: { ...editor.style, fontFamily: event.currentTarget.value } })}>
                    <option value="Microsoft YaHei">微软雅黑</option>
                    <option value="Segoe UI">Segoe UI</option>
                    <option value="SimSun">宋体</option>
                    <option value="KaiTi">楷体</option>
                  </select>
                </CompactField>
                <CompactField label="字号">
                  <select className="card-settings-select" value={editor.style.fontSize} onChange={(event) => updateEditor({ style: { ...editor.style, fontSize: clamp(Number(event.currentTarget.value), 8, 16) } })}>
                    {courseFontSizeOptions.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </CompactField>
                <CompactField label="粗细">
                  <select className="card-settings-select" value={editor.style.fontWeight} onChange={(event) => updateEditor({ style: { ...editor.style, fontWeight: event.currentTarget.value as CardDraft["fontWeight"] } })}>
                    <option value="regular">常规</option>
                    <option value="medium">中等</option>
                    <option value="bold">加粗</option>
                  </select>
                </CompactField>
              </div>
              <div className="style-row-secondary temporary-display-row">
                <div className="card-settings-field display-mode-control">
                  <select
                    className="card-settings-select card-settings-select-narrow display-mode-select"
                    value={editor.style.displayMode}
                    onChange={(event) => updateEditor({ style: { ...editor.style, displayMode: event.currentTarget.value as CardDraft["displayMode"] } })}
                  >
                    <option value="auto" title="有辅助信息时自动显示双行，没有辅助信息时显示单行">
                      自动
                    </option>
                    <option value="oneLine" title="只显示一行课程名">
                      单行
                    </option>
                    <option value="twoLine" title="有辅助信息时固定双行，没有辅助信息时自动退回单行">
                      双行
                    </option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </details>
      </div>

      <SettingsCard
        title="改动日期"
        action={
          <button type="button" className="card-settings-secondary temporary-pick-date" onClick={() => setCalendarOpen(true)}>
            选择日期
          </button>
        }
      >
        <div className="date-chip-row">
          {sortDates(editor.dates).length === 0 ? (
            <span className="temporary-date-empty">暂未选择日期</span>
          ) : (
            sortDates(editor.dates).map((date) => (
              <span className="date-chip" key={date}>
                {formatDateChip(date)}
                <button type="button" aria-label={`删除 ${date}`} onClick={() => removeDate(date)}>
                  ×
                </button>
              </span>
            ))
          )}
        </div>
      </SettingsCard>

      <button type="button" className="temporary-save-button" onClick={() => saveChange(false)}>
        保存本次临时改动
      </button>
      {feedback ? <div className="temporary-feedback">{feedback}</div> : null}

      <SettingsCard
        title="改动历史"
        action={
          <button type="button" className="card-settings-secondary temporary-delete-history" disabled={!activeChange} onClick={deleteHistory}>
            删除该条历史
          </button>
        }
      >
        {sortedChanges.length === 0 ? (
          <div className="temporary-list-empty">暂无改动历史</div>
        ) : (
          <select className="card-settings-select temporary-history-select" value={activeChange?.id ?? ""} onChange={(event) => onSelectChange(event.currentTarget.value || null)}>
            <option value="" disabled>
              选择改动历史
            </option>
            {sortedChanges.map((change) => (
              <option key={change.id} value={change.id}>
                {formatTemporaryHistorySummary(change)}
              </option>
            ))}
          </select>
        )}
      </SettingsCard>

      {calendarOpen ? (
        <MultiSelectCalendarDialog
          selectedDates={editor.dates}
          onCancel={() => setCalendarOpen(false)}
          onConfirm={(dates) => {
            updateEditor({ dates });
            setCalendarOpen(false);
          }}
        />
      ) : null}

      {replaceConfirmChange ? (
        <div className="temporary-confirm-overlay" role="alertdialog" aria-modal="true" aria-label="替换临时改动">
          <div className="temporary-confirm-dialog">
            <p>当前课程已有一条有效临时改动。保存后将替换原有效改动，是否继续？</p>
            <div>
              <button type="button" className="card-settings-secondary" onClick={() => setReplaceConfirmChange(null)}>
                取消
              </button>
              <button type="button" className="temporary-confirm-primary" onClick={() => saveChange(true)}>
                替换并保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MultiSelectCalendarDialog({
  selectedDates,
  onCancel,
  onConfirm,
}: {
  selectedDates: string[];
  onCancel: () => void;
  onConfirm: (dates: string[]) => void;
}) {
  const initialMonth = getCalendarInitialMonth(selectedDates);
  const [monthDate, setMonthDate] = useState(initialMonth);
  const [draftDates, setDraftDates] = useState<string[]>(() => sortDates(selectedDates));
  const days = buildCalendarMonthDays(monthDate);
  const monthLabel = `${monthDate.getFullYear()}年${monthDate.getMonth() + 1}月`;

  const shiftMonth = (delta: number) => {
    setMonthDate((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };

  const toggleDate = (date: string) => {
    setDraftDates((current) => (current.includes(date) ? current.filter((item) => item !== date) : sortDates([...current, date])));
  };

  return (
    <div className="temporary-calendar-overlay" role="dialog" aria-modal="true" aria-label="选择改动日期">
      <div className="temporary-calendar-dialog">
        <header className="temporary-calendar-header">
          <button type="button" aria-label="上一月" onClick={() => shiftMonth(-1)}>
            ‹
          </button>
          <strong>{monthLabel}</strong>
          <button type="button" aria-label="下一月" onClick={() => shiftMonth(1)}>
            ›
          </button>
        </header>
        <div className="temporary-calendar-weekdays" aria-hidden="true">
          {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="temporary-calendar-grid">
          {days.map((day) => (
            <button
              key={day.date}
              type="button"
              className={[
                "temporary-calendar-day",
                day.inMonth ? "" : "is-outside",
                draftDates.includes(day.date) ? "is-selected" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => toggleDate(day.date)}
            >
              {day.dayOfMonth}
            </button>
          ))}
        </div>
        <footer className="temporary-calendar-footer">
          <button type="button" className="card-settings-secondary" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="card-settings-secondary" onClick={() => setDraftDates([])}>
            清空
          </button>
          <button type="button" className="temporary-confirm-primary" onClick={() => onConfirm(sortDates(draftDates))}>
            确定
          </button>
        </footer>
      </div>
    </div>
  );
}

function SettingsCard({ title, action, className, children }: { title?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={["settings-card", className].filter(Boolean).join(" ")}>
      {title ? (
        <header className="settings-card-header">
          <h2>{title}</h2>
          {action}
        </header>
      ) : null}
      <div className="settings-card-content">{children}</div>
    </section>
  );
}

function CompactField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="card-settings-field">
      <span>{label}</span>
      <div>{children}</div>
    </label>
  );
}

function DatePickerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openPicker = () => {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }

    input.focus();
    input.click();
  };

  return (
    <label className="card-settings-field date-picker-field">
      <span>{label}</span>
      <div className="date-picker-control">
        <input
          ref={inputRef}
          aria-label={label}
          className="card-settings-input date-picker-input"
          type="date"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <button type="button" className="date-picker-icon-button" aria-label={`打开${label}日历`} title={`打开${label}日历`} onClick={openPicker}>
          <CalendarIcon />
        </button>
      </div>
    </label>
  );
}

function RowCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="row-card">
      <div className="row-card-label">{label}</div>
      <div className="row-card-content">{children}</div>
    </section>
  );
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="setting-card-row">
      <span>{label}</span>
      <div>{children}</div>
    </label>
  );
}

function ColorPickerRow({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="color-dot-row">
      {courseCardPresetColors.map((color) => (
        <button
          key={color.value}
          type="button"
          className={color.value.toLowerCase() === value.toLowerCase() ? "color-dot is-active" : "color-dot"}
          style={{ "--dot-color": color.value } as CSSProperties}
          aria-label={`选择颜色 ${color.name} ${color.value}`}
          title={`${color.name} ${color.value}`}
          onClick={() => onChange(color.value)}
        />
      ))}
      <label className="custom-color-trigger" style={{ "--dot-color": value } as CSSProperties} aria-label="自定义颜色" title={value}>
        <input type="color" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
      </label>
    </div>
  );
}

function createEditableTemporaryChange(change: TemporaryChangeDraft | null): TemporaryChangeDraft {
  const now = new Date().toISOString();
  return {
    id: change?.id ?? `temporary-change-${now}-${Math.random().toString(16).slice(2, 8)}`,
    type: change?.type ?? "cancel",
    dates: [...(change?.dates ?? [])],
    title: change?.title ?? change?.replaceTitle ?? "",
    subtitle: change?.subtitle ?? change?.replaceSecondary ?? "",
    color: change?.color ?? change?.replaceColor ?? "#4f46e5",
    style: {
      fontFamily: change?.style?.fontFamily ?? "Microsoft YaHei",
      fontSize: change?.style?.fontSize ?? 14,
      fontWeight: change?.style?.fontWeight ?? "medium",
      displayMode: change?.style?.displayMode ?? "auto",
    },
    createdAt: change?.createdAt ?? now,
    updatedAt: change?.updatedAt ?? now,
    replaceTitle: change?.replaceTitle ?? "",
    replaceSecondary: change?.replaceSecondary ?? "",
    replaceColor: change?.replaceColor ?? change?.color ?? "#4f46e5",
  };
}

function normalizeTemporaryEditor(change: TemporaryChangeDraft): TemporaryChangeDraft {
  const now = new Date().toISOString();
  const title = limitCardText(change.title || change.replaceTitle || "");
  const subtitle = limitCardText(change.subtitle || change.replaceSecondary || "");
  const color = (change.color || change.replaceColor || "#4f46e5").trim();
  return {
    ...change,
    title,
    subtitle,
    color,
    dates: sortDates(change.dates),
    createdAt: change.createdAt || now,
    updatedAt: now,
    replaceTitle: title,
    replaceSecondary: subtitle,
    replaceColor: color,
  };
}

function isEffectiveTemporaryChange(change: TemporaryChangeDraft): boolean {
  return change.dates.some((date) => date >= todayIso);
}

function sortTemporaryChangesByUpdatedAt(left: TemporaryChangeDraft, right: TemporaryChangeDraft): number {
  return Date.parse(right.updatedAt ?? right.createdAt ?? "") - Date.parse(left.updatedAt ?? left.createdAt ?? "");
}

function sortDates(dates: string[]): string[] {
  return [...dates].sort((left, right) => left.localeCompare(right));
}

function formatTemporaryHistorySummary(change: TemporaryChangeDraft): string {
  const datePart = summarizeDates(change.dates);
  const titlePart = change.title || change.replaceTitle || "未命名";
  const subtitlePart = change.subtitle || change.replaceSecondary || "";
  return [datePart, titlePart, subtitlePart].filter(Boolean).join(" · ");
}

function summarizeDates(dates: string[]): string {
  const sorted = sortDates(dates);
  if (sorted.length === 0) {
    return "无日期";
  }

  const preview = sorted.slice(0, 3).map(formatDateChip);
  const suffix = sorted.length > 3 ? ` +${sorted.length - 3}` : "";
  return `${preview.join("、")}${suffix}`;
}

function getCalendarInitialMonth(dates: string[]): Date {
  const first = sortDates(dates)[0];
  if (!first) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const parsed = new Date(`${first}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
}

function buildCalendarMonthDays(monthDate: Date): Array<{ date: string; dayOfMonth: number; inMonth: boolean }> {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startDay = firstOfMonth.getDay();
  const start = new Date(year, month, 1 - startDay);
  const result: Array<{ date: string; dayOfMonth: number; inMonth: boolean }> = [];

  for (let index = 0; index < 42; index += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    result.push({
      date: formatIsoDate(current),
      dayOfMonth: current.getDate(),
      inMonth: current.getMonth() === month,
    });
  }

  return result;
}

function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <rect x="4.5" y="5.5" width="15" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 4.5v3M16 4.5v3M5.5 9.5h13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 13h3M13 13h3M8 16h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}

function formatDateChip(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${String(parsed.getMonth() + 1).padStart(2, "0")}/${String(parsed.getDate()).padStart(2, "0")} ${weekdays[parsed.getDay()]}`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function limitCardText(value: string): string {
  return value.slice(0, 4);
}
