import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";
import type {
  CardDraft,
  CourseCardMergeState,
  SelectedCard,
  TemporaryChangeDraft,
  TemporaryChangeType,
} from "../../features/settings/settingsTypes";

type CardSettingsWindowProps = {
  selectedCard: SelectedCard | null;
  draft: CardDraft;
  mergeState: CourseCardMergeState;
  temporaryChanges: TemporaryChangeDraft[];
  activeTemporaryChangeId: string | null;
  onDraftChange: (draft: CardDraft) => void;
  onMergeRight: () => void;
  onSplit: () => void;
  onConfirm: () => void;
  onClose: () => void;
  onTemporaryChangeAdd: () => void;
  onTemporaryChangeSelect: (id: string | null) => void;
  onTemporaryChangeUpdate: (change: TemporaryChangeDraft) => void;
  onTemporaryChangeRemove: (id: string) => void;
};

type CardSettingsTab = "course" | "temporary";

const masterColors = ["#f97316", "#facc15", "#22c55e", "#38bdf8", "#818cf8", "#f472b6"];
const fontSizeOptions = Array.from({ length: 15 }, (_, index) => index + 10);
const todayIso = new Date().toISOString().slice(0, 10);

export function CardSettingsWindow({
  selectedCard,
  draft,
  mergeState,
  temporaryChanges,
  activeTemporaryChangeId,
  onDraftChange,
  onMergeRight,
  onSplit,
  onConfirm,
  onClose,
  onTemporaryChangeAdd,
  onTemporaryChangeSelect,
  onTemporaryChangeUpdate,
  onTemporaryChangeRemove,
}: CardSettingsWindowProps) {
  const [activeTab, setActiveTab] = useState<CardSettingsTab>("course");
  const [historyExpanded, setHistoryExpanded] = useState(false);

  if (!selectedCard) {
    return null;
  }

  const currentTemporaryChangeId = activeTemporaryChangeId ?? temporaryChanges[0]?.id ?? null;

  const removeTemporaryDate = (change: TemporaryChangeDraft, date: string) => {
    const nextDates = change.dates.filter((item) => item !== date);
    if (nextDates.length === 0) {
      onTemporaryChangeRemove(change.id);
      return;
    }

    onTemporaryChangeUpdate({ ...change, dates: nextDates });
  };

  return (
    <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label="课程卡片设置">
      <section className="card-settings-window">
        <header className="card-settings-topbar">
          <nav className="card-settings-tabs" aria-label="卡片设置分类">
            <button type="button" className={activeTab === "course" ? "is-active" : ""} onClick={() => setActiveTab("course")}>
              课程配置
            </button>
            <button type="button" className={activeTab === "temporary" ? "is-active" : ""} onClick={() => setActiveTab("temporary")}>
              临时改动
            </button>
          </nav>
          <button className="card-settings-confirm" type="button" aria-label="确认并关闭" title="确认并关闭" onClick={onConfirm}>
            ✓
          </button>
        </header>

        <div className="card-settings-body">
          {activeTab === "course" ? (
            selectedCard.type === "course" ? (
              <CourseConfigurationTab draft={draft} mergeState={mergeState} onDraftChange={onDraftChange} onMergeRight={onMergeRight} onSplit={onSplit} />
            ) : (
              <PeriodConfigurationTab draft={draft} onDraftChange={onDraftChange} />
            )
          ) : (
            <TemporaryChangesTab
              changes={temporaryChanges}
              activeChange={temporaryChanges.find((change) => change.id === currentTemporaryChangeId) ?? null}
              historyExpanded={historyExpanded}
              onHistoryExpandedChange={setHistoryExpanded}
              onAddChange={onTemporaryChangeAdd}
              onSelectChange={onTemporaryChangeSelect}
              onUpdateChange={onTemporaryChangeUpdate}
              onRemoveChange={onTemporaryChangeRemove}
              onRemoveDate={removeTemporaryDate}
            />
          )}
        </div>

      </section>
    </div>
  );
}

function CourseConfigurationTab({
  draft,
  mergeState,
  onDraftChange,
  onMergeRight,
  onSplit,
}: {
  draft: CardDraft;
  mergeState: CourseCardMergeState;
  onDraftChange: (draft: CardDraft) => void;
  onMergeRight: () => void;
  onSplit: () => void;
}) {
  return (
    <div className="course-config-stack">
      <SettingsCard
        title="基础信息"
        action={
          <label className="card-settings-header-control">
            <span>显示模式</span>
            <select className="card-settings-select" defaultValue="auto">
              <option value="follow" title="继承课程表全局显示规则">跟随课表</option>
              <option value="auto" title="有辅助信息时自动显示双行">自动</option>
              <option value="single" title="只显示一行课程名">单行</option>
              <option value="double" title="课程名和辅助信息固定双行">双行</option>
            </select>
          </label>
        }
      >
        <div className="basic-inline-inputs">
          <label>
            <span>课程名</span>
            <input
              className="card-settings-input"
              value={draft.title}
              maxLength={4}
              placeholder="课程名"
              onChange={(event) => onDraftChange({ ...draft, title: limitCardText(event.currentTarget.value) })}
            />
          </label>
          <label>
            <span>辅助信息</span>
            <input
              className="card-settings-input"
              value={draft.secondary}
              maxLength={4}
              placeholder="辅助信息"
              onChange={(event) => onDraftChange({ ...draft, secondary: limitCardText(event.currentTarget.value) })}
            />
          </label>
        </div>
        <ColorPickerRow value={draft.backgroundColor} onChange={(backgroundColor) => onDraftChange({ ...draft, backgroundColor })} />
        <details className="font-popover-row">
          <summary>字体</summary>
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
                {fontSizeOptions.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>粗细</span>
              <select className="card-settings-select" defaultValue="medium">
                <option value="regular">常规</option>
                <option value="medium">中等</option>
                <option value="bold">加粗</option>
              </select>
            </label>
          </div>
        </details>
      </SettingsCard>

      <SettingsCard
        title="排课日期"
        action={
          <button type="button" className="card-settings-link" onClick={() => onDraftChange({ ...draft, applyWholeTerm: true })}>
            使用学期起止日期
          </button>
        }
      >
        <SettingRow label="单双周">
          <select
            className="card-settings-select compact-select"
            value={draft.weekPattern}
            onChange={(event) => onDraftChange({ ...draft, weekPattern: event.currentTarget.value as CardDraft["weekPattern"] })}
          >
            <option value="all">每周</option>
            <option value="odd">单周</option>
            <option value="even">双周</option>
          </select>
        </SettingRow>
        <div className="card-settings-date-pair">
          <input aria-label="开始日期" className="card-settings-input" type="date" value={draft.startDate} onChange={(event) => onDraftChange({ ...draft, applyWholeTerm: false, startDate: event.currentTarget.value })} />
          <input aria-label="结束日期" className="card-settings-input" type="date" value={draft.endDate} onChange={(event) => onDraftChange({ ...draft, applyWholeTerm: false, endDate: event.currentTarget.value })} />
        </div>
      </SettingsCard>

      <details className="settings-card card-settings-accordion">
        <summary>高级设置：合并 / 拆分</summary>
        <div className="merge-panel">
          <div className="merge-dpad" aria-label="合并方向">
            <button type="button" disabled>
              ↑ 上合并
            </button>
            <button type="button" disabled>
              ← 左合并
            </button>
            <span>当前</span>
            <button type="button" disabled={!mergeState.canMergeRight} onClick={onMergeRight}>
              右合并 →
            </button>
            <button type="button" disabled>
              ↓ 下合并
            </button>
          </div>
          <button className="split-card-button" type="button" disabled={!mergeState.canSplit} onClick={onSplit}>
            拆分当前卡片
          </button>
        </div>
        {mergeState.reason && <p className="card-settings-hint">{mergeState.reason}</p>}
        <p className="card-settings-hint">当合并组内课程名、辅助信息、单双周或有效日期不一致时，后续会自动拆分为独立卡片。</p>
      </details>
    </div>
  );
}

function PeriodConfigurationTab({ draft, onDraftChange }: { draft: CardDraft; onDraftChange: (draft: CardDraft) => void }) {
  return (
    <div className="course-config-stack period-config-grid">
      <SettingsCard title="基础信息">
        <div className="basic-inline-inputs">
          <label>
            <span>课次名</span>
            <input className="card-settings-input" value={draft.title} maxLength={4} placeholder="课次名" onChange={(event) => onDraftChange({ ...draft, title: limitCardText(event.currentTarget.value) })} />
          </label>
          <label>
            <span>时间</span>
            <input className="card-settings-input" value={draft.secondary} maxLength={4} placeholder="时间" onChange={(event) => onDraftChange({ ...draft, secondary: limitCardText(event.currentTarget.value) })} />
          </label>
        </div>
        <ColorPickerRow value={draft.backgroundColor} onChange={(backgroundColor) => onDraftChange({ ...draft, backgroundColor })} />
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
              {fontSizeOptions.map((size) => (
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
  activeChange,
  historyExpanded,
  onHistoryExpandedChange,
  onAddChange,
  onSelectChange,
  onUpdateChange,
  onRemoveChange,
  onRemoveDate,
}: {
  changes: TemporaryChangeDraft[];
  activeChange: TemporaryChangeDraft | null;
  historyExpanded: boolean;
  onHistoryExpandedChange: (expanded: boolean) => void;
  onAddChange: () => void;
  onSelectChange: (id: string | null) => void;
  onUpdateChange: (change: TemporaryChangeDraft) => void;
  onRemoveChange: (id: string) => void;
  onRemoveDate: (change: TemporaryChangeDraft, date: string) => void;
}) {
  const recentChanges = useMemo(() => changes.filter((change) => change.dates.some((date) => date >= todayIso)), [changes]);
  const historyChanges = useMemo(() => changes.filter((change) => change.dates.every((date) => date < todayIso)), [changes]);

  return (
    <div className="temporary-layout">
      <aside className="temporary-list">
        <button className="temporary-add-button" type="button" onClick={onAddChange}>
          + 新增临时改动
        </button>
        <TemporaryListGroup title="最近有效" expanded changes={recentChanges} activeId={activeChange?.id ?? null} onSelect={onSelectChange} />
        <section className="temporary-group">
          <button className="temporary-group-title" type="button" onClick={() => onHistoryExpandedChange(!historyExpanded)}>
            历史记录
            <span>{historyExpanded ? "收起" : "展开"}</span>
          </button>
          {historyExpanded && <TemporaryList changes={historyChanges} activeId={activeChange?.id ?? null} onSelect={onSelectChange} />}
        </section>
      </aside>

      <section className="temporary-editor">
        {activeChange ? (
          <TemporaryChangeEditor
            change={activeChange}
            onUpdateChange={onUpdateChange}
            onRemoveDate={onRemoveDate}
          />
        ) : (
          <div className="temporary-empty">
            <h3>暂无改动</h3>
            <p>点击左侧“新增临时改动”后，在这里设置日期和改动内容。</p>
          </div>
        )}
      </section>
    </div>
  );
}

function TemporaryChangeEditor({
  change,
  onUpdateChange,
  onRemoveDate,
}: {
  change: TemporaryChangeDraft;
  onUpdateChange: (change: TemporaryChangeDraft) => void;
  onRemoveDate: (change: TemporaryChangeDraft, date: string) => void;
}) {
  const updateType = (type: TemporaryChangeType) => {
    onUpdateChange({ ...change, type });
  };

  const addDate = () => {
    if (change.dates.includes(todayIso)) {
      return;
    }
    onUpdateChange({ ...change, dates: [...change.dates, todayIso] });
  };

  return (
    <div className="temporary-editor-form">
      <select className="card-settings-select temporary-type-control" value={change.type} onChange={(event) => updateType(event.currentTarget.value as TemporaryChangeType)}>
        <option value="cancel">临时取消</option>
        <option value="replace">临时换课</option>
      </select>

      <SettingsCard title="适用日期">
        <div className="date-chip-row">
          {change.dates.map((date) => (
            <span className="date-chip" key={date}>
              {formatDateChip(date)}
              <button type="button" aria-label={`删除 ${date}`} onClick={() => onRemoveDate(change, date)}>
                ×
              </button>
            </span>
          ))}
          <button className="add-date-chip" type="button" onClick={addDate}>
            + 添加日期
          </button>
        </div>
      </SettingsCard>

      {change.type === "cancel" ? (
        <div className="temporary-result-card">结果：无课</div>
      ) : (
        <SettingsCard title="替换课程">
          <SettingRow label="替换课程名称">
            <input className="card-settings-input" value={change.replaceTitle} maxLength={4} placeholder="课程名" onChange={(event) => onUpdateChange({ ...change, replaceTitle: limitCardText(event.currentTarget.value) })} />
          </SettingRow>
          <SettingRow label="替换辅助信息">
            <input className="card-settings-input" value={change.replaceSecondary} maxLength={4} placeholder="辅助信息" onChange={(event) => onUpdateChange({ ...change, replaceSecondary: limitCardText(event.currentTarget.value) })} />
          </SettingRow>
          <SettingRow label="颜色">
            <ColorPickerRow value={change.replaceColor} onChange={(replaceColor) => onUpdateChange({ ...change, replaceColor })} />
          </SettingRow>
        </SettingsCard>
      )}

    </div>
  );
}

function TemporaryListGroup({
  title,
  expanded,
  changes,
  activeId,
  onSelect,
}: {
  title: string;
  expanded: boolean;
  changes: TemporaryChangeDraft[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <section className="temporary-group">
      <div className="temporary-group-title">
        {title}
        <span>{changes.length}</span>
      </div>
      {expanded && <TemporaryList changes={changes} activeId={activeId} onSelect={onSelect} />}
    </section>
  );
}

function TemporaryList({
  changes,
  activeId,
  onSelect,
}: {
  changes: TemporaryChangeDraft[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (changes.length === 0) {
    return <p className="temporary-list-empty">暂无记录</p>;
  }

  return (
    <div className="temporary-list-items">
      {changes.map((change) => (
        <button key={change.id} type="button" className={change.id === activeId ? "temporary-list-item is-active" : "temporary-list-item"} onClick={() => onSelect(change.id)}>
          <span>{formatDateChip(change.dates[0])}</span>
          <strong>{change.type === "cancel" ? "[取消] 无课" : `[换课] ${change.replaceTitle || "未命名"}`}</strong>
        </button>
      ))}
    </div>
  );
}

function SettingsCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-card">
      <header className="settings-card-header">
        <h2>{title}</h2>
        {action}
      </header>
      <div className="settings-card-content">{children}</div>
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
      {masterColors.map((color) => (
        <button
          key={color}
          type="button"
          className={color.toLowerCase() === value.toLowerCase() ? "color-dot is-active" : "color-dot"}
          style={{ "--dot-color": color } as CSSProperties}
          aria-label={`选择颜色 ${color}`}
          onClick={() => onChange(color)}
        />
      ))}
      <label className="custom-color-trigger" style={{ "--dot-color": value } as CSSProperties} aria-label="自定义颜色">
        <input type="color" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
      </label>
    </div>
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
