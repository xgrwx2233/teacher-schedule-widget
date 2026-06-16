import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CardDraft,
  CourseCardMergeState,
  SelectedCard,
  TemporaryChangeDraft,
} from "../../features/settings/settingsTypes";
import { courseCardPresetColors } from "../../features/settings/settingsTypes";
import type { CardSettingsTitleContext } from "../../features/settings/windowEvents";

type CardSettingsWindowProps = {
  selectedCard: SelectedCard | null;
  activeTab: CardSettingsTab;
  draft: CardDraft;
  mergeState: CourseCardMergeState;
  term: { startDate: string; endDate: string };
  titleContext?: CardSettingsTitleContext;
  defaultTemporaryDate?: string;
  temporaryChanges: TemporaryChangeDraft[];
  activeTemporaryChangeId: string | null;
  onActiveTabChange: (tab: CardSettingsTab) => void;
  onDraftChange: (draft: CardDraft) => void;
  onMergeUp: () => void;
  onMergeLeft: () => void;
  onMergeRight: () => void;
  onMergeDown: () => void;
  onSplit: () => void;
  onDeleteCourse: () => void;
  onGlobalStyleApply: () => void;
  onGlobalScheduleApply: () => void;
  onTemporaryChangeSelect: (id: string | null) => void;
  onTemporaryChangeUpdate: (change: TemporaryChangeDraft) => void;
  onTemporaryChangeRemove: (id: string) => void;
  onTemporaryDraftTitleChange: (title: string) => void;
};

type CardSettingsTab = "course" | "temporary";

type TemporaryHistoryEntry = {
  change: TemporaryChangeDraft;
  date: string;
  completed: boolean;
};

const courseFontSizeOptions = Array.from(
  { length: 9 },
  (_, index) => index + 8,
);
const periodFontSizeOptions = Array.from(
  { length: 9 },
  (_, index) => index + 8,
);
const todayIso = getBeijingDateIso();

export function CardSettingsWindow({
  selectedCard,
  activeTab,
  draft,
  mergeState,
  term,
  titleContext,
  defaultTemporaryDate,
  temporaryChanges,
  activeTemporaryChangeId,
  onActiveTabChange,
  onDraftChange,
  onMergeUp,
  onMergeLeft,
  onMergeRight,
  onMergeDown,
  onSplit,
  onDeleteCourse,
  onGlobalStyleApply,
  onGlobalScheduleApply,
  onTemporaryChangeSelect,
  onTemporaryChangeUpdate,
  onTemporaryChangeRemove,
  onTemporaryDraftTitleChange,
}: CardSettingsWindowProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const temporaryTabInitializedCardRef = useRef<string | null>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeTab, selectedCard]);

  useEffect(() => {
    temporaryTabInitializedCardRef.current = null;
    if (selectedCard?.type === "period") {
      onActiveTabChange("course");
    }
  }, [onActiveTabChange, selectedCard]);

  if (!selectedCard) {
    return null;
  }

  if (selectedCard.type === "period") {
    return (
      <div
        className="settings-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="课次卡片设置"
      >
        <section className="card-settings-window period-settings-window">
          <div className="card-settings-body is-period-settings" ref={bodyRef}>
            <PeriodConfigurationTab
              draft={draft}
              onDraftChange={onDraftChange}
            />
          </div>
        </section>
      </div>
    );
  }

  const openTemporaryTab = () => {
    if (temporaryTabInitializedCardRef.current !== selectedCard.courseId) {
      temporaryTabInitializedCardRef.current = selectedCard.courseId;
      onTemporaryChangeSelect(null);
    }

    onActiveTabChange("temporary");
  };

  return (
    <div
      className="settings-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="课程卡片设置"
    >
      <section className="card-settings-window">
        <nav className="card-settings-tabs" aria-label="卡片设置分类">
          <button
            type="button"
            className={activeTab === "course" ? "is-active" : ""}
            onClick={() => onActiveTabChange("course")}
          >
            课程配置
          </button>
          <button
            type="button"
            className={activeTab === "temporary" ? "is-active" : ""}
            onClick={openTemporaryTab}
          >
            临时改动
          </button>
        </nav>

        <div
          className={
            activeTab === "temporary"
              ? "card-settings-body is-temporary-tab"
              : "card-settings-body"
          }
          ref={bodyRef}
        >
          {activeTab === "course" ? (
            selectedCard.type === "course" ? (
              <CourseConfigurationTab
                draft={draft}
                term={term}
                mergeState={mergeState}
                onDraftChange={onDraftChange}
                onMergeUp={onMergeUp}
                onMergeLeft={onMergeLeft}
                onMergeRight={onMergeRight}
                onMergeDown={onMergeDown}
                onSplit={onSplit}
                onDeleteCourse={onDeleteCourse}
                onGlobalStyleApply={onGlobalStyleApply}
                onGlobalScheduleApply={onGlobalScheduleApply}
              />
            ) : (
              <PeriodConfigurationTab
                draft={draft}
                onDraftChange={onDraftChange}
              />
            )
          ) : (
            <TemporaryChangesTab
              changes={temporaryChanges}
              activeChangeId={activeTemporaryChangeId}
              term={term}
              titleContext={titleContext}
              defaultDate={defaultTemporaryDate}
              onSelectChange={onTemporaryChangeSelect}
              onUpdateChange={onTemporaryChangeUpdate}
              onRemoveChange={onTemporaryChangeRemove}
              onEditorTitleChange={onTemporaryDraftTitleChange}
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
  onMergeUp,
  onMergeLeft,
  onMergeRight,
  onMergeDown,
  onSplit,
  onDeleteCourse,
  onGlobalStyleApply,
  onGlobalScheduleApply,
}: {
  draft: CardDraft;
  term: { startDate: string; endDate: string };
  mergeState: CourseCardMergeState;
  onDraftChange: (draft: CardDraft) => void;
  onMergeUp: () => void;
  onMergeLeft: () => void;
  onMergeRight: () => void;
  onMergeDown: () => void;
  onSplit: () => void;
  onDeleteCourse: () => void;
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
              <LimitedTextInput
                className="card-settings-input"
                value={draft.title}
                maxLength={4}
                placeholder="社团"
                onCommit={(title) => onDraftChange({ ...draft, title })}
              />
            </label>
            <label className="basic-info-field">
              <span>辅助信息</span>
              <LimitedTextInput
                className="card-settings-input"
                value={draft.secondary}
                maxLength={5}
                placeholder="活动室"
                onCommit={(secondary) => onDraftChange({ ...draft, secondary })}
              />
            </label>
          </div>
          <div className="basic-info-color">
            <span>颜色</span>
            <ColorPickerRow
              value={draft.backgroundColor}
              onChange={(backgroundColor) =>
                onDraftChange({ ...draft, backgroundColor })
              }
            />
          </div>
        </div>
      </SettingsCard>

      <div className="accordion-group">
        <details className="row-card row-card-accordion accordion-style">
          <summary>
            <span className="row-card-label">风格</span>
            <span
              className="card-settings-accordion-chevron"
              aria-hidden="true"
            >
              ▾
            </span>
          </summary>
          <div className="row-card-accordion-content">
            <div className="style-row-stack">
              <div className="style-row-grid">
                <CompactField label="字体">
                  <select
                    className="card-settings-select"
                    value={draft.fontFamily}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        fontFamily: event.currentTarget.value,
                      })
                    }
                  >
                    <option value="Microsoft YaHei">微软雅黑</option>
                    <option value="Segoe UI">Segoe UI</option>
                    <option value="SimSun">宋体</option>
                    <option value="KaiTi">楷体</option>
                  </select>
                </CompactField>
                <CompactField label="字号">
                  <select
                    className="card-settings-select"
                    value={draft.fontSize}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        fontSize: clamp(
                          Number(event.currentTarget.value),
                          8,
                          16,
                        ),
                      })
                    }
                  >
                    {courseFontSizeOptions.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </CompactField>
                <CompactField label="粗细">
                  <select
                    className="card-settings-select"
                    value={draft.fontWeight}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        fontWeight: event.currentTarget
                          .value as CardDraft["fontWeight"],
                      })
                    }
                  >
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
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        displayMode: event.currentTarget
                          .value as typeof draft.displayMode,
                      })
                    }
                  >
                    <option
                      value="auto"
                      title="有辅助信息时自动显示双行，没有辅助信息时显示单行"
                    >
                      自动
                    </option>
                    <option value="oneLine" title="只显示一行课程名">
                      单行
                    </option>
                    <option
                      value="twoLine"
                      title="有辅助信息时固定双行，没有辅助信息时自动退回单行"
                    >
                      双行
                    </option>
                  </select>
                </div>
                <button
                  type="button"
                  className="card-settings-secondary action-global-apply"
                  onClick={onGlobalStyleApply}
                >
                  全局应用
                </button>
              </div>
            </div>
          </div>
        </details>

        <details className="row-card row-card-accordion accordion-date">
          <summary>
            <span className="row-card-label">排课日期</span>
            <span
              className="card-settings-accordion-chevron"
              aria-hidden="true"
            >
              ▾
            </span>
          </summary>
          <div className="row-card-accordion-content">
            <div className="schedule-row-top">
              <DatePickerField
                label="开始日期"
                value={draft.startDate}
                onChange={(startDate) =>
                  onDraftChange({ ...draft, applyWholeTerm: false, startDate })
                }
              />
              <DatePickerField
                label="结束日期"
                value={draft.endDate}
                onChange={(endDate) =>
                  onDraftChange({ ...draft, applyWholeTerm: false, endDate })
                }
              />
            </div>
            <div className="schedule-row-bottom">
              <select
                className="card-settings-select compact-select schedule-pattern-select"
                value={draft.weekPattern}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    weekPattern: event.currentTarget
                      .value as CardDraft["weekPattern"],
                  })
                }
              >
                <option value="all">每周</option>
                <option value="odd">单周</option>
                <option value="even">双周</option>
              </select>
              <button
                type="button"
                className="icon-chip-button"
                title="使用学期起止日期"
                aria-label="使用学期起止日期"
                onClick={() =>
                  onDraftChange({
                    ...draft,
                    applyWholeTerm: true,
                    startDate: term.startDate,
                    endDate: term.endDate,
                  })
                }
              >
                <CalendarIcon />
              </button>
              <button
                type="button"
                className="card-settings-secondary action-global-apply schedule-global-apply"
                onClick={onGlobalScheduleApply}
              >
                全局应用
              </button>
            </div>
          </div>
        </details>

        <details className="row-card row-card-accordion accordion-merge">
          <summary>
            <span className="row-card-label">合并 / 拆分</span>
            <span
              className="card-settings-accordion-chevron"
              aria-hidden="true"
            >
              ▾
            </span>
          </summary>
          <div className="row-card-accordion-content">
            <div className="merge-panel">
              <div className="merge-dpad" aria-label="合并方向">
                <button
                  type="button"
                  disabled={!mergeState.canMergeUp}
                  onClick={onMergeUp}
                >
                  上合并
                </button>
                <button
                  type="button"
                  disabled={!mergeState.canMergeLeft}
                  onClick={onMergeLeft}
                >
                  左合并
                </button>
                <button
                  type="button"
                  disabled={!mergeState.canMergeRight}
                  onClick={onMergeRight}
                >
                  右合并
                </button>
                <button
                  type="button"
                  disabled={!mergeState.canMergeDown}
                  onClick={onMergeDown}
                >
                  下合并
                </button>
              </div>
              <button
                className="split-card-button"
                type="button"
                disabled={!mergeState.canSplit}
                onClick={onSplit}
              >
                拆分
              </button>
            </div>
          </div>
        </details>
      </div>
      <div className="course-config-footer">
        <button
          type="button"
          className="card-settings-footer-action card-settings-danger"
          onClick={onDeleteCourse}
        >
          删除
        </button>
      </div>
    </div>
  );
}

function PeriodConfigurationTab({
  draft,
  onDraftChange,
}: {
  draft: CardDraft;
  onDraftChange: (draft: CardDraft) => void;
}) {
  return (
    <div className="period-settings-stack">
      <SettingsCard className="period-settings-card">
        <div className="period-primary-grid">
          <label className="period-settings-field">
            <span>课次</span>
            <LimitedTextInput
              className="card-settings-input period-name-input"
              value={draft.title}
              maxLength={3}
              placeholder="第5节"
              onCommit={(title) => onDraftChange({ ...draft, title })}
            />
          </label>
          <TimeRangeField
            value={draft.secondary}
            onChange={(secondary) => onDraftChange({ ...draft, secondary })}
          />
        </div>
      </SettingsCard>

      <SettingsCard className="period-settings-card">
        <div className="period-style-grid">
          <label className="period-settings-field">
            <span>字体</span>
            <select
              className="card-settings-select"
              value={draft.fontFamily}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  fontFamily: event.currentTarget.value,
                })
              }
            >
              <option value="Microsoft YaHei">微软雅黑</option>
              <option value="Segoe UI">Segoe UI</option>
              <option value="SimSun">宋体</option>
              <option value="KaiTi">楷体</option>
            </select>
          </label>
          <label className="period-settings-field">
            <span>字号</span>
            <select
              className="card-settings-select"
              value={draft.fontSize}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  fontSize: clamp(Number(event.currentTarget.value), 8, 16),
                })
              }
            >
              {periodFontSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="period-color-grid">
          <div className="period-color-field">
            <span>字体颜色</span>
            <ColorPickerRow
              value={draft.color}
              onChange={(color) =>
                onDraftChange({ ...draft, color, iconColor: color })
              }
            />
          </div>
          <div className="period-color-field">
            <span>背景颜色</span>
            <ColorPickerRow
              value={draft.backgroundColor}
              onChange={(backgroundColor) =>
                onDraftChange({ ...draft, backgroundColor })
              }
            />
          </div>
        </div>
      </SettingsCard>
    </div>
  );

  return (
    <div className="course-config-stack period-config-grid">
      <SettingsCard title="基础信息">
        <div className="basic-inline-inputs">
          <label>
            <span>课次</span>
            <input
              className="card-settings-input"
              value={draft.title}
              maxLength={4}
              placeholder="课次"
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  title: limitCardText(event.currentTarget.value),
                })
              }
            />
          </label>
          <label>
            <span>时间</span>
            <input
              className="card-settings-input"
              value={draft.secondary}
              maxLength={4}
              placeholder="时间"
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  secondary: limitCardText(event.currentTarget.value),
                })
              }
            />
          </label>
        </div>
        <SettingRow label="颜色">
          <ColorPickerRow
            value={draft.backgroundColor}
            onChange={(backgroundColor) =>
              onDraftChange({ ...draft, backgroundColor })
            }
          />
        </SettingRow>
        <div className="typography-matrix">
          <label>
            <span>字体</span>
            <select
              className="card-settings-select"
              value={draft.fontFamily}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  fontFamily: event.currentTarget.value,
                })
              }
            >
              <option value="Microsoft YaHei">微软雅黑</option>
              <option value="Segoe UI">Segoe UI</option>
              <option value="SimSun">宋体</option>
              <option value="KaiTi">楷体</option>
            </select>
          </label>
          <label>
            <span>字号</span>
            <select
              className="card-settings-select"
              value={draft.fontSize}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  fontSize: clamp(Number(event.currentTarget.value), 8, 16),
                })
              }
            >
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

function TimeRangeField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { start, end } = splitTimeRange(value);

  const updateTime = (nextStart: string, nextEnd: string) => {
    onChange(`${nextStart || "00:00"}-${nextEnd || "00:00"}`);
  };

  return (
    <div className="period-time-inputs">
      <label className="period-settings-field">
        <span>开始时间</span>
        <input
          className="card-settings-input period-time-input"
          type="time"
          value={start}
          aria-label="开始时间"
          onChange={(event) => updateTime(event.currentTarget.value, end)}
        />
      </label>
      <label className="period-settings-field">
        <span>结束时间</span>
        <input
          className="card-settings-input period-time-input"
          type="time"
          value={end}
          aria-label="结束时间"
          onChange={(event) => updateTime(start, event.currentTarget.value)}
        />
      </label>
    </div>
  );
}

function splitTimeRange(value: string): { start: string; end: string } {
  const [start = "", end = ""] = value.split("-");
  return {
    start: normalizeTimeValue(start),
    end: normalizeTimeValue(end),
  };
}

function normalizeTimeValue(value: string): string {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim());
  if (!match) {
    return "";
  }

  const hours = clamp(Number(match[1]), 0, 23);
  const minutes = clamp(Number(match[2]), 0, 59);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function TemporaryChangesTab({
  changes,
  activeChangeId,
  term,
  titleContext,
  defaultDate,
  onSelectChange,
  onUpdateChange,
  onRemoveChange,
  onEditorTitleChange,
}: {
  changes: TemporaryChangeDraft[];
  activeChangeId: string | null;
  term: { startDate: string; endDate: string };
  titleContext?: CardSettingsTitleContext;
  defaultDate?: string;
  onSelectChange: (id: string | null) => void;
  onUpdateChange: (change: TemporaryChangeDraft) => void;
  onRemoveChange: (id: string) => void;
  onEditorTitleChange: (title: string) => void;
}) {
  const sortedChanges = useMemo(
    () => [...changes].sort(sortTemporaryChangesByDate),
    [changes],
  );
  const historyEntries = useMemo(
    () => createTemporaryHistoryEntries(changes),
    [changes],
  );
  const [activeHistoryDate, setActiveHistoryDate] = useState<string | null>(
    null,
  );
  const activeSourceChange =
    sortedChanges.find((change) => change.id === activeChangeId) ?? null;
  const activeChange = useMemo(
    () =>
      activeSourceChange
        ? {
            ...activeSourceChange,
            dates: activeHistoryDate
              ? [activeHistoryDate]
              : activeSourceChange.dates.slice(0, 1),
          }
        : null,
    [activeHistoryDate, activeSourceChange],
  );
  const resolvedDefaultDate = useMemo(
    () => resolveDefaultTemporaryDate(defaultDate, titleContext, term),
    [defaultDate, term, titleContext],
  );
  const [editor, setEditor] = useState<TemporaryChangeDraft>(() =>
    createEditableTemporaryChange(activeChange, resolvedDefaultDate),
  );
  const defaultDateSeededRef = useRef(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [replaceConfirmChange, setReplaceConfirmChange] =
    useState<TemporaryChangeDraft | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const isNoClass = editor.type === "cancel";
  const sortedEditorDates = sortDates(editor.dates);

  useEffect(() => {
    if (!activeChangeId) {
      setActiveHistoryDate(null);
    }
  }, [activeChangeId]);

  useEffect(() => {
    setEditor(
      createEditableTemporaryChange(
        activeChange,
        activeChange ? undefined : resolvedDefaultDate,
      ),
    );
    if (activeChange) {
      defaultDateSeededRef.current = true;
    } else {
      defaultDateSeededRef.current = Boolean(resolvedDefaultDate);
    }
    setFeedback("");
  }, [activeChange, resolvedDefaultDate]);

  useEffect(() => {
    if (activeChange || !resolvedDefaultDate || defaultDateSeededRef.current) {
      return;
    }

    setEditor((current) => {
      if (current.dates.length > 0) {
        return current;
      }

      return {
        ...current,
        dates: [resolvedDefaultDate],
      };
    });
    defaultDateSeededRef.current = true;
  }, [activeChange, resolvedDefaultDate]);

  useEffect(() => {
    onEditorTitleChange(editor.title);
  }, [editor.title, onEditorTitleChange]);

  const updateEditor = (patch: Partial<TemporaryChangeDraft>) => {
    setEditor((current) => ({
      ...current,
      ...patch,
      replaceTitle: patch.title ?? patch.replaceTitle ?? current.replaceTitle,
      replaceSecondary:
        patch.subtitle ?? patch.replaceSecondary ?? current.replaceSecondary,
      replaceColor: patch.color ?? patch.replaceColor ?? current.replaceColor,
    }));
  };

  const setTemporaryMode = (mode: TemporaryChangeDraft["type"]) => {
    if (mode === "cancel") {
      updateEditor({
        type: "cancel",
        title: "无课",
        subtitle: "",
      });
      return;
    }

    updateEditor({
      type: "replace",
      title: editor.title.trim() === "无课" ? "" : editor.title,
    });
  };

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

  const saveChange = (_forceReplace = false) => {
    const normalized = normalizeTemporaryEditor(editor);
    if (normalized.dates.length === 0) {
      setFeedback("请至少选择一个改动日期");
      return;
    }

    if (normalized.type === "replace" && !normalized.title.trim()) {
      setFeedback("请先填写课程名");
      return;
    }

    if (activeChangeId && normalized.dates.length > 1) {
      setFeedback("每次只能修改一条改动信息");
      return;
    }

    const conflictDate = normalized.dates.find((date) =>
      changes.some(
        (change) =>
          change.dates.includes(date) &&
          !(change.id === normalized.id && activeHistoryDate === date),
      ),
    );
    if (conflictDate) {
      setFeedback(
        `${formatDateChip(conflictDate)} 已有临时改课，重复改课。请先删除冲突的改课信息后再添加。`,
      );
      return;
    }

    if (normalized.dates.length === 1) {
      const shouldSplitPackedEntry = Boolean(
        activeSourceChange &&
        activeSourceChange.dates.length > 1 &&
        activeHistoryDate,
      );
      const nextChange = shouldSplitPackedEntry
        ? {
            ...normalized,
            id: `${normalized.id}-${normalized.dates[0]}-${Date.now().toString(36)}`,
          }
        : normalized;
      if (shouldSplitPackedEntry && activeSourceChange && activeHistoryDate) {
        onUpdateChange({
          ...activeSourceChange,
          dates: activeSourceChange.dates.filter(
            (date) => date !== activeHistoryDate,
          ),
          updatedAt: new Date().toISOString(),
        });
      }
      onUpdateChange(nextChange);
      onSelectChange(nextChange.id);
      setActiveHistoryDate(nextChange.dates[0]);
      setEditor(nextChange);
      setReplaceConfirmChange(null);
      setFeedback("已保存");
      return;
    }

    const timestamp = Date.now().toString(36);
    const splitChanges = normalized.dates.map((date, index) => ({
      ...normalized,
      id: `${normalized.id}-${date}-${timestamp}-${index}`,
      dates: [date],
    }));
    splitChanges.forEach(onUpdateChange);
    onSelectChange(splitChanges[0]?.id ?? null);
    setActiveHistoryDate(splitChanges[0]?.dates[0] ?? null);
    setEditor(splitChanges[0] ?? createEditableTemporaryChange(null));
    setReplaceConfirmChange(null);
    setFeedback("已保存");
  };

  const deleteHistoryEntry = (entry: TemporaryHistoryEntry) => {
    if (entry.completed) {
      return;
    }

    if (entry.change.dates.length > 1) {
      onUpdateChange({
        ...entry.change,
        dates: entry.change.dates.filter((date) => date !== entry.date),
        updatedAt: new Date().toISOString(),
      });
    } else {
      onRemoveChange(entry.change.id);
    }

    onSelectChange(null);
    setActiveHistoryDate(null);
    setEditor(createEditableTemporaryChange(null));
    setFeedback("");
  };

  const editHistoryEntry = (entry: TemporaryHistoryEntry) => {
    if (entry.completed) {
      return;
    }
    setActiveHistoryDate(entry.date);
    onSelectChange(entry.change.id);
    setEditor(
      createEditableTemporaryChange({ ...entry.change, dates: [entry.date] }),
    );
    setHistoryOpen(true);
    setFeedback("");
  };

  return (
    <div className="temporary-config-stack">
      <SettingsCard title="改动日期" className="temporary-date-card">
        <div className="date-chip-row temporary-date-chip-row">
          {sortedEditorDates.map((date) => (
            <span className="date-chip" key={date}>
              {formatDateChip(date)}
              <button
                type="button"
                aria-label={`删除 ${date}`}
                onClick={() => removeDate(date)}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            className="temporary-date-add"
            title="选择日期"
            aria-label="选择日期"
            onClick={() => setCalendarOpen(true)}
          >
            +
          </button>
        </div>
      </SettingsCard>

      <div
        className="temporary-mode-radio-row"
        role="radiogroup"
        aria-label="临时改动类型"
      >
        <button
          type="button"
          role="radio"
          aria-checked={isNoClass}
          className={
            isNoClass
              ? "temporary-radio-option is-active"
              : "temporary-radio-option"
          }
          onClick={() => setTemporaryMode("cancel")}
        >
          <span aria-hidden="true" />
          不上啦
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!isNoClass}
          className={
            !isNoClass
              ? "temporary-radio-option is-active"
              : "temporary-radio-option"
          }
          onClick={() => setTemporaryMode("replace")}
        >
          <span aria-hidden="true" />
          换课
        </button>
      </div>

      {!isNoClass ? (
        <SettingsCard className="temporary-content-form-card">
          <div className="temporary-content-form">
            <div className="basic-info-grid">
              <div className="basic-info-inline">
                <label className="basic-info-field">
                  <span>课程名</span>
                  <LimitedTextInput
                    className="card-settings-input"
                    value={editor.title}
                    maxLength={4}
                    placeholder="社团"
                    onCommit={(title) => updateEditor({ title })}
                  />
                </label>
                <label className="basic-info-field">
                  <span>辅助信息</span>
                  <LimitedTextInput
                    className="card-settings-input"
                    value={editor.subtitle}
                    maxLength={5}
                    placeholder="活动室"
                    onCommit={(subtitle) => updateEditor({ subtitle })}
                  />
                </label>
              </div>
              <div className="basic-info-color">
                <span>颜色</span>
                <ColorPickerRow
                  value={editor.color}
                  onChange={(color) => updateEditor({ color })}
                />
              </div>
            </div>

            <div className="accordion-group temporary-style-group">
              <details className="row-card row-card-accordion accordion-style">
                <summary>
                  <span className="row-card-label">风格</span>
                  <span
                    className="card-settings-accordion-chevron"
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                </summary>
                <div className="row-card-accordion-content">
                  <div className="style-row-stack">
                    <div className="style-row-grid">
                      <CompactField label="字体">
                        <select
                          className="card-settings-select"
                          value={editor.style.fontFamily}
                          onChange={(event) =>
                            updateEditor({
                              style: {
                                ...editor.style,
                                fontFamily: event.currentTarget.value,
                              },
                            })
                          }
                        >
                          <option value="Microsoft YaHei">微软雅黑</option>
                          <option value="Segoe UI">Segoe UI</option>
                          <option value="SimSun">宋体</option>
                          <option value="KaiTi">楷体</option>
                        </select>
                      </CompactField>
                      <CompactField label="字号">
                        <select
                          className="card-settings-select"
                          value={editor.style.fontSize}
                          onChange={(event) =>
                            updateEditor({
                              style: {
                                ...editor.style,
                                fontSize: clamp(
                                  Number(event.currentTarget.value),
                                  8,
                                  16,
                                ),
                              },
                            })
                          }
                        >
                          {courseFontSizeOptions.map((size) => (
                            <option key={size} value={size}>
                              {size}
                            </option>
                          ))}
                        </select>
                      </CompactField>
                      <CompactField label="粗细">
                        <select
                          className="card-settings-select"
                          value={editor.style.fontWeight}
                          onChange={(event) =>
                            updateEditor({
                              style: {
                                ...editor.style,
                                fontWeight: event.currentTarget
                                  .value as CardDraft["fontWeight"],
                              },
                            })
                          }
                        >
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
                          onChange={(event) =>
                            updateEditor({
                              style: {
                                ...editor.style,
                                displayMode: event.currentTarget
                                  .value as CardDraft["displayMode"],
                              },
                            })
                          }
                        >
                          <option
                            value="auto"
                            title="有辅助信息时自动显示双行，没有辅助信息时显示单行"
                          >
                            自动
                          </option>
                          <option value="oneLine" title="只显示一行课程名">
                            单行
                          </option>
                          <option
                            value="twoLine"
                            title="有辅助信息时固定双行，没有辅助信息时自动退回单行"
                          >
                            双行
                          </option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </SettingsCard>
      ) : null}

      <button
        type="button"
        className="temporary-save-button"
        onClick={() => saveChange(false)}
      >
        确认并保存
      </button>
      {feedback ? <div className="temporary-feedback">{feedback}</div> : null}

      <details
        className="settings-card temporary-history-drawer"
        open={historyOpen}
        onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
      >
        <summary>
          <span>改动历史</span>
          <span className="card-settings-accordion-chevron" aria-hidden="true">
            ▾
          </span>
        </summary>
        <div className="settings-card-content temporary-history-content">
          {historyEntries.length === 0 ? (
            <div className="temporary-list-empty">
              {"\u6682\u65e0\u6539\u52a8\u5386\u53f2"}
            </div>
          ) : (
            <div className="temporary-history-list">
              {historyEntries.map((entry) => (
                <div
                  key={`${entry.change.id}:${entry.date}`}
                  className={[
                    "temporary-history-item",
                    entry.change.id === activeChange?.id &&
                    entry.date === activeHistoryDate
                      ? "is-active"
                      : "",
                    entry.completed ? "is-completed" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <button
                    type="button"
                    className="temporary-history-item-main"
                    disabled={entry.completed}
                    onClick={() => editHistoryEntry(entry)}
                  >
                    {formatTemporaryHistoryEntrySummary(entry)}
                  </button>
                  {entry.completed ? (
                    <span className="temporary-history-status">
                      {"\u5df2\u5b8c\u7ed3"}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="temporary-history-delete"
                      aria-label={"\u5220\u9664\u6539\u52a8\u5386\u53f2"}
                      onClick={() => deleteHistoryEntry(entry)}
                    >
                      {"\u5220\u9664"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

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
        <div
          className="temporary-confirm-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-label="替换临时改动"
        >
          <div className="temporary-confirm-dialog">
            <p>
              当前课程已有一条有效临时改动。保存后将替换原有效改动，是否继续？
            </p>
            <div>
              <button
                type="button"
                className="card-settings-secondary"
                onClick={() => setReplaceConfirmChange(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="temporary-confirm-primary"
                onClick={() => saveChange(true)}
              >
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
  const [draftDates, setDraftDates] = useState<string[]>(() =>
    sortDates(selectedDates),
  );
  const days = buildCalendarMonthDays(monthDate);
  const monthLabel = `${monthDate.getFullYear()}年${monthDate.getMonth() + 1}月`;

  const shiftMonth = (delta: number) => {
    setMonthDate(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + delta, 1),
    );
  };

  const toggleDate = (date: string) => {
    setDraftDates((current) =>
      current.includes(date)
        ? current.filter((item) => item !== date)
        : sortDates([...current, date]),
    );
  };

  return (
    <div
      className="temporary-calendar-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="选择改动日期"
    >
      <div className="temporary-calendar-dialog">
        <header className="temporary-calendar-header">
          <button
            type="button"
            aria-label="上一月"
            onClick={() => shiftMonth(-1)}
          >
            ‹
          </button>
          <strong>{monthLabel}</strong>
          <button
            type="button"
            aria-label="下一月"
            onClick={() => shiftMonth(1)}
          >
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
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => toggleDate(day.date)}
            >
              {day.dayOfMonth}
            </button>
          ))}
        </div>
        <footer className="temporary-calendar-footer">
          <button
            type="button"
            className="card-settings-secondary"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="card-settings-secondary"
            onClick={() => setDraftDates([])}
          >
            清空
          </button>
          <button
            type="button"
            className="temporary-confirm-primary"
            onClick={() => onConfirm(sortDates(draftDates))}
          >
            确定
          </button>
        </footer>
      </div>
    </div>
  );
}

function SettingsCard({
  title,
  action,
  className,
  children,
}: {
  title?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
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

function LimitedTextInput({
  value,
  maxLength,
  className,
  placeholder,
  disabled = false,
  onCommit,
}: {
  value: string;
  maxLength: number;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  onCommit: (value: string) => void;
}) {
  const [localValue, setLocalValue] = useState(value);
  const composingRef = useRef(false);

  useEffect(() => {
    if (!composingRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const commit = (nextValue: string) => {
    const normalized = limitTextByCharacters(nextValue, maxLength);
    setLocalValue(normalized);
    onCommit(normalized);
  };

  return (
    <input
      className={className}
      value={localValue}
      placeholder={placeholder}
      disabled={disabled}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        commit(event.currentTarget.value);
      }}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        const isComposing =
          composingRef.current || (event.nativeEvent as InputEvent).isComposing;
        if (isComposing) {
          setLocalValue(nextValue);
          return;
        }

        commit(nextValue);
      }}
      onBlur={(event) => {
        if (composingRef.current) {
          composingRef.current = false;
        }

        commit(event.currentTarget.value);
      }}
    />
  );
}

function CompactField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
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
        <button
          type="button"
          className="date-picker-icon-button"
          aria-label={`打开${label}日历`}
          title={`打开${label}日历`}
          onClick={openPicker}
        >
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

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="setting-card-row">
      <span>{label}</span>
      <div>{children}</div>
    </label>
  );
}

function ColorPickerRow({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="color-dot-row">
      {courseCardPresetColors.map((color) => (
        <button
          key={color.value}
          type="button"
          className={
            color.value.toLowerCase() === value.toLowerCase()
              ? "color-dot is-active"
              : "color-dot"
          }
          style={{ "--dot-color": color.value } as CSSProperties}
          aria-label={`选择颜色 ${color.name} ${color.value}`}
          title={`${color.name} ${color.value}`}
          onClick={() => onChange(color.value)}
        />
      ))}
      <label
        className="custom-color-trigger"
        style={{ "--dot-color": value } as CSSProperties}
        aria-label="自定义颜色"
        title={value}
      >
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </label>
    </div>
  );
}

function createEditableTemporaryChange(
  change: TemporaryChangeDraft | null,
  defaultDate?: string,
): TemporaryChangeDraft {
  const now = new Date().toISOString();
  return {
    id:
      change?.id ??
      `temporary-change-${now}-${Math.random().toString(16).slice(2, 8)}`,
    type: change?.type ?? "cancel",
    dates: [...(change?.dates ?? (defaultDate ? [defaultDate] : []))],
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

function resolveDefaultTemporaryDate(
  defaultDate: string | undefined,
  titleContext: CardSettingsTitleContext | undefined,
  term: { startDate: string; endDate: string },
): string | undefined {
  if (isIsoDate(defaultDate)) {
    return defaultDate;
  }

  if (isIsoDate(titleContext?.date)) {
    return titleContext?.date;
  }

  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(titleContext?.dateLabel ?? "");
  if (!match) {
    return undefined;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day)) {
    return undefined;
  }

  const startYear = Number(term.startDate.slice(0, 4));
  const endYear = Number(term.endDate.slice(0, 4));
  const startMonth = Number(term.startDate.slice(5, 7));
  const year =
    endYear !== startYear && month < startMonth ? endYear : startYear;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isIsoDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function getBeijingDateIso(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeTemporaryEditor(
  change: TemporaryChangeDraft,
): TemporaryChangeDraft {
  const now = new Date().toISOString();
  const isCancel = change.type === "cancel";
  const title = isCancel
    ? "无课"
    : limitCardText(change.title || change.replaceTitle || "");
  const subtitle = isCancel
    ? ""
    : limitTextByCharacters(
        change.subtitle || change.replaceSecondary || "",
        5,
      );
  const color = (change.color || change.replaceColor || "#4f46e5").trim();
  return {
    ...change,
    type: isCancel ? "cancel" : "replace",
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

function createTemporaryHistoryEntries(
  changes: TemporaryChangeDraft[],
): TemporaryHistoryEntry[] {
  return changes
    .flatMap((change) =>
      sortDates(change.dates).map((date) => ({
        change,
        date,
        completed: date < todayIso,
      })),
    )
    .sort((left, right) => right.date.localeCompare(left.date));
}

function sortTemporaryChangesByDate(
  left: TemporaryChangeDraft,
  right: TemporaryChangeDraft,
): number {
  const leftDate = sortDates(left.dates)[0] ?? "";
  const rightDate = sortDates(right.dates)[0] ?? "";
  return rightDate.localeCompare(leftDate);
}

function sortTemporaryChangesByUpdatedAt(
  left: TemporaryChangeDraft,
  right: TemporaryChangeDraft,
): number {
  return (
    Date.parse(right.updatedAt ?? right.createdAt ?? "") -
    Date.parse(left.updatedAt ?? left.createdAt ?? "")
  );
}

function sortDates(dates: string[]): string[] {
  return [...dates].sort((left, right) => left.localeCompare(right));
}

function formatTemporaryHistorySummary(change: TemporaryChangeDraft): string {
  const datePart = summarizeDates(change.dates);
  if (change.type === "cancel") {
    return [datePart, "不上啦"].filter(Boolean).join(" · ");
  }

  const titlePart = change.title || change.replaceTitle || "未命名";
  const subtitlePart = change.subtitle || change.replaceSecondary || "";
  return [datePart, "换课", titlePart, subtitlePart]
    .filter(Boolean)
    .join(" · ");
}

function formatTemporaryHistoryEntrySummary(
  entry: TemporaryHistoryEntry,
): string {
  return formatTemporaryHistorySummary({
    ...entry.change,
    dates: [entry.date],
  });
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

function buildCalendarMonthDays(
  monthDate: Date,
): Array<{ date: string; dayOfMonth: number; inMonth: boolean }> {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startDay = firstOfMonth.getDay();
  const start = new Date(year, month, 1 - startDay);
  const result: Array<{ date: string; dayOfMonth: number; inMonth: boolean }> =
    [];

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
      <rect
        x="4.5"
        y="5.5"
        width="15"
        height="14"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M8 4.5v3M16 4.5v3M5.5 9.5h13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M8 13h3M13 13h3M8 16h3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.85"
      />
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
  return limitTextByCharacters(value, 4);
}

function limitTextByCharacters(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}
