import type { PointerEvent, SyntheticEvent } from "react";
import { useMemo, useState } from "react";
import type { WorkdayMode } from "../../features/schedule/types";
import type {
  BlockPeriodSettings,
  BlockSettings,
  BlockSettingsState,
  BlockType,
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
  onApplyBlockSettings: (blockSettings: BlockSettingsState) => void;
  onDragStart?: (event: PointerEvent<HTMLElement>) => void;
  onClose: () => void;
};

type ConflictSummary = {
  count: number;
  firstPeriodId: string | null;
  periodIds: Set<string>;
  blockIds: Set<string>;
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
  onApplyBlockSettings,
  onDragStart,
  onClose,
}: SettingsWindowProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label="设置">
      <section className="settings-window settings-window-wide">
        <header className="settings-header">
          <div className="settings-titlebar" onPointerDown={onDragStart}>
            <div>
              <h2>设置</h2>
              <p>修改后将同步到课程表挂件</p>
            </div>
          </div>
          <button className="settings-close-button" type="button" onClick={onClose} aria-label="关闭">
            X
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-sidebar" aria-label="设置导航">
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
            )}

            {activeSection === "blocks" && (
              <BlockSettingsPanel
                settings={settings}
                onSettingsChange={onSettingsChange}
                onApplyBlockSettings={onApplyBlockSettings}
                onClose={onClose}
              />
            )}
          </main>
        </div>
      </section>
    </div>
  );
}

function BlockSettingsPanel({
  settings,
  onSettingsChange,
  onApplyBlockSettings,
  onClose,
}: {
  settings: WidgetSettingsState;
  onSettingsChange: (settings: WidgetSettingsState) => void;
  onApplyBlockSettings: (blockSettings: BlockSettingsState) => void;
  onClose: () => void;
}) {
  const [openStyleBlockId, setOpenStyleBlockId] = useState<string | null>(null);
  const blockSettings = useMemo(() => normalizeBlockConflicts(settings.blockSettings), [settings.blockSettings]);
  const activeBlock = blockSettings.blocks.find((block) => block.id === blockSettings.activeBlockId) ?? blockSettings.blocks[0] ?? null;
  const activePeriod = findPeriodInBlocks(blockSettings, blockSettings.activePeriodId) ?? activeBlock?.periods[0] ?? null;
  const conflictSummary = getConflictSummary(blockSettings);
  const selectedIsPlaceholder = activeBlock?.type === "placeholder";

  const commitBlockSettings = (nextBlockSettings: BlockSettingsState) => {
    onSettingsChange({ ...settings, blockSettings: normalizeBlockConflicts(nextBlockSettings) });
  };

  const selectBlock = (blockId: string) => {
    const nextBlock = blockSettings.blocks.find((item) => item.id === blockId);
    if (!nextBlock) {
      return;
    }

    commitBlockSettings({
      ...blockSettings,
      activeBlockId: blockId,
      activePeriodId: nextBlock.periods[0]?.id ?? null,
    });
  };

  const selectPeriod = (blockId: string, periodId: string) => {
    commitBlockSettings({
      ...blockSettings,
      activeBlockId: blockId,
      activePeriodId: periodId,
    });
  };

  const updateBlock = (
    blockId: string,
    patch: Partial<Pick<BlockSettings, "name" | "cardBackgroundColor" | "cardCornerRadius">>,
  ) => {
    commitBlockSettings({
      ...blockSettings,
      blocks: blockSettings.blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)),
    });
  };

  const updatePeriod = (blockId: string, periodId: string, patch: Partial<BlockPeriodSettings>) => {
    commitBlockSettings({
      ...blockSettings,
      blocks: blockSettings.blocks.map((block) =>
        block.id === blockId
          ? {
              ...block,
              periods: block.periods.map((period) => (period.id === periodId ? { ...period, ...patch } : period)),
            }
          : block,
      ),
    });
  };

  const addBlock = (type: BlockType) => {
    const nextId = `${type}-${Date.now()}`;
    const nextBlock: BlockSettings =
      type === "course"
        ? {
            id: nextId,
            name: "新课程块",
            type: "course",
            cardBackgroundColor: "#fff8e1",
            cardCornerRadius: 10,
            periods: [createDefaultPeriod(`${nextId}-p1`, 0)],
          }
        : {
            id: nextId,
            name: "新占位块",
            type: "placeholder",
            cardBackgroundColor: "#e3f2fd",
            cardCornerRadius: 10,
            periods: [createDefaultPeriod(`${nextId}-p1`, 0, "午休", "12:00", "14:00")],
          };

    commitBlockSettings({
      ...blockSettings,
      activeBlockId: nextBlock.id,
      activePeriodId: nextBlock.periods[0]?.id ?? null,
      blocks: [...blockSettings.blocks, nextBlock],
    });
  };

  const addPeriodAfterActive = () => {
    if (!activeBlock || activeBlock.type !== "course") {
      return;
    }

    const activeIndex = activePeriod
      ? activeBlock.periods.findIndex((period) => period.id === activePeriod.id)
      : activeBlock.periods.length - 1;
    const insertIndex = Math.max(0, activeIndex) + 1;
    const previous = activeBlock.periods[Math.max(0, insertIndex - 1)];
    const nextPeriod = createDefaultPeriod(
      `${activeBlock.id}-p${Date.now()}`,
      insertIndex,
      `第${activeBlock.periods.length + 1}节`,
      shiftTime(previous?.endTime ?? "08:45", 10),
      shiftTime(previous?.endTime ?? "08:45", 55),
    );

    commitBlockSettings({
      ...blockSettings,
      activePeriodId: nextPeriod.id,
      blocks: blockSettings.blocks.map((block) => {
        if (block.id !== activeBlock.id || block.type !== "course") {
          return block;
        }

        const periods = [...block.periods];
        periods.splice(insertIndex, 0, nextPeriod);
        return { ...block, periods: withPeriodOrder(periods) };
      }),
    });
  };

  const deletePeriod = (blockId: string, periodId: string) => {
    const block = blockSettings.blocks.find((item) => item.id === blockId);
    const period = block?.periods.find((item) => item.id === periodId);
    if (!block || !period) {
      return;
    }

    const deletesBlock = block.type === "placeholder" || block.periods.length === 1;
    if (deletesBlock) {
      const ok = window.confirm("当前课次是该块的唯一课次。继续删除会删除整个块，是否继续？");
      if (!ok) {
        return;
      }
    } else if (!window.confirm("删除课次会同时移除该行已有课程卡片。是否继续？")) {
      return;
    }

    if (deletesBlock) {
      const nextBlocks = blockSettings.blocks.filter((item) => item.id !== block.id);
      commitBlockSettings({
        ...blockSettings,
        blocks: nextBlocks,
        activeBlockId: nextBlocks[0]?.id ?? null,
        activePeriodId: nextBlocks[0]?.periods[0]?.id ?? null,
      });
      return;
    }

    commitBlockSettings({
      ...blockSettings,
      blocks: blockSettings.blocks.map((current) =>
        current.id === block.id && current.type === "course"
          ? { ...current, periods: withPeriodOrder(current.periods.filter((item) => item.id !== period.id)) }
          : current,
      ),
      activePeriodId: block.periods.find((item) => item.id !== period.id)?.id ?? null,
    });
  };

  const movePeriod = (blockId: string, periodId: string, direction: -1 | 1) => {
    const block = blockSettings.blocks.find((item) => item.id === blockId);
    if (!block || block.type !== "course") {
      return;
    }

    const index = block.periods.findIndex((period) => period.id === periodId);
    const target = index + direction;
    if (target < 0 || target >= block.periods.length) {
      return;
    }

    const nextPeriods = [...block.periods];
    const [item] = nextPeriods.splice(index, 1);
    nextPeriods.splice(target, 0, item);

    commitBlockSettings({
      ...blockSettings,
      activeBlockId: block.id,
      activePeriodId: periodId,
      blocks: blockSettings.blocks.map((current) =>
        current.id === block.id && current.type === "course" ? { ...current, periods: withPeriodOrder(nextPeriods) } : current,
      ),
    });
  };

  const moveBlock = (blockId: string, direction: -1 | 1) => {
    const index = blockSettings.blocks.findIndex((block) => block.id === blockId);
    const target = index + direction;
    if (target < 0 || target >= blockSettings.blocks.length) {
      return;
    }

    const nextBlocks = [...blockSettings.blocks];
    const [item] = nextBlocks.splice(index, 1);
    nextBlocks.splice(target, 0, item);

    commitBlockSettings({ ...blockSettings, blocks: nextBlocks, activeBlockId: blockId });
  };

  const applyChanges = () => {
    const normalized = normalizeBlockConflicts(blockSettings);
    const nextSummary = getConflictSummary(normalized);
    if (nextSummary.firstPeriodId) {
      commitBlockSettings(normalized);
      focusPeriod(nextSummary.firstPeriodId);
      return;
    }

    onApplyBlockSettings(normalized);
  };

  return (
    <section className="settings-panel-section block-settings-section">
      <div className="block-settings-toolbar timeline-toolbar">
        <div className="block-settings-toolbar-left">
          <button type="button" className="toolbar-action" onClick={() => addBlock("course")}>
            添加课程块
          </button>
          <button type="button" className="toolbar-action" onClick={() => addBlock("placeholder")}>
            添加占位块
          </button>
          <button
            type="button"
            className="toolbar-action primary"
            onClick={addPeriodAfterActive}
            disabled={selectedIsPlaceholder}
            title={selectedIsPlaceholder ? "占位块只能包含一个课次" : undefined}
          >
            添加课次
          </button>
        </div>
        <div className="block-settings-toolbar-right">
          {conflictSummary.count > 0 && <span className="block-conflict-hint">冲突 {conflictSummary.count} 项</span>}
          <button type="button" className="toolbar-action" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="toolbar-action primary" onClick={applyChanges}>
            应用修改
          </button>
        </div>
      </div>

      <div className="block-settings-layout timeline-layout">
        <section className="block-list-panel">
          <div className="block-panel-header">
            <h3>课程块</h3>
            <span>{blockSettings.blocks.length} 个块</span>
          </div>
          <div className="block-list">
            {blockSettings.blocks.map((block) => (
              <BlockCard
                key={block.id}
                block={block}
                selected={block.id === activeBlock?.id}
                hasConflict={conflictSummary.blockIds.has(block.id)}
                styleOpen={openStyleBlockId === block.id}
                onToggleStyle={() => setOpenStyleBlockId(openStyleBlockId === block.id ? null : block.id)}
                onSelect={() => selectBlock(block.id)}
                onRename={(name) => updateBlock(block.id, { name })}
                onChangeTone={(cardBackgroundColor) => updateBlock(block.id, { cardBackgroundColor })}
                onChangeRadius={(cardCornerRadius) => updateBlock(block.id, { cardCornerRadius })}
                onMoveUp={() => moveBlock(block.id, -1)}
                onMoveDown={() => moveBlock(block.id, 1)}
              />
            ))}
          </div>
        </section>

        <section className="period-list-panel timeline-panel">
          <div className="block-panel-header">
            <h3>课次时间轴</h3>
            <span>全部课次展开</span>
          </div>
          <div className="period-list timeline-list">
            {blockSettings.blocks.map((block) => (
              <div className="period-block-group timeline-group" key={block.id}>
                <div className="period-block-title">
                  <strong>{block.name}</strong>
                  <span>{formatBlockTimeRange(block)}</span>
                </div>
                {block.periods.map((period) => (
                  <PeriodRow
                    key={period.id}
                    blockType={block.type}
                    period={period}
                    selected={block.id === activeBlock?.id && period.id === activePeriod?.id}
                    conflict={conflictSummary.periodIds.has(period.id)}
                    onSelect={() => selectPeriod(block.id, period.id)}
                    onChangeName={(name) => updatePeriod(block.id, period.id, { name })}
                    onChangeStartTime={(startTime) => updatePeriod(block.id, period.id, { startTime })}
                    onChangeEndTime={(endTime) => updatePeriod(block.id, period.id, { endTime })}
                    onMoveUp={() => movePeriod(block.id, period.id, -1)}
                    onMoveDown={() => movePeriod(block.id, period.id, 1)}
                    onDelete={() => deletePeriod(block.id, period.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function BlockCard({
  block,
  selected,
  hasConflict,
  styleOpen,
  onToggleStyle,
  onSelect,
  onRename,
  onChangeTone,
  onChangeRadius,
  onMoveUp,
  onMoveDown,
}: {
  block: BlockSettings;
  selected: boolean;
  hasConflict: boolean;
  styleOpen: boolean;
  onToggleStyle: () => void;
  onSelect: () => void;
  onRename: (name: string) => void;
  onChangeTone: (tone: string) => void;
  onChangeRadius: (radius: number) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const className = ["block-card", "timeline-block-card", selected ? "is-selected" : "", hasConflict ? "has-conflict" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={className} onClick={onSelect}>
      <div className="block-drag-handle" title="拖动排序">
        ⋮⋮
      </div>
      <div className="block-card-main">
        <div className="block-card-title-row">
          <input
            className="block-name-input"
            value={block.name}
            onChange={(event) => onRename(event.currentTarget.value)}
            onClick={stopPropagation}
          />
          <span className="period-kind-tag">{block.type === "course" ? "课程块" : "占位块"}</span>
        </div>
        <div className="block-card-metrics">
          <span>{block.periods.length} 个课次</span>
          <span>{formatBlockTimeRange(block)}</span>
          {hasConflict && <strong>时间冲突</strong>}
        </div>
      </div>
      <div className="block-style-area">
        <button className="style-button" type="button" onClick={stopAndRun(onToggleStyle)}>
          <span className="style-swatch" style={{ background: block.cardBackgroundColor }} />
          样式
        </button>
        <span className="radius-value">{block.cardCornerRadius}px</span>
        {styleOpen && (
          <div className="style-popover" onClick={stopPropagation}>
            <label>
              <span>块内课程卡片背景色</span>
              <input type="color" value={block.cardBackgroundColor} onChange={(event) => onChangeTone(event.currentTarget.value)} />
            </label>
            <label>
              <span>块内课程卡片圆角 {block.cardCornerRadius}px</span>
              <input
                type="range"
                min="0"
                max="16"
                value={block.cardCornerRadius}
                onChange={(event) => onChangeRadius(Number(event.currentTarget.value))}
              />
            </label>
          </div>
        )}
      </div>
      <div className="block-card-more">
        <button type="button" onClick={stopAndRun(onMoveUp)} title="上移块">
          ↑
        </button>
        <button type="button" onClick={stopAndRun(onMoveDown)} title="下移块">
          ↓
        </button>
      </div>
    </article>
  );
}

function PeriodRow({
  period,
  blockType,
  selected,
  conflict,
  onSelect,
  onChangeName,
  onChangeStartTime,
  onChangeEndTime,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  period: BlockPeriodSettings;
  blockType: BlockType;
  selected: boolean;
  conflict: boolean;
  onSelect: () => void;
  onChangeName: (name: string) => void;
  onChangeStartTime: (startTime: string) => void;
  onChangeEndTime: (endTime: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const className = ["period-row", "timeline-period-row", selected ? "is-selected" : "", conflict ? "is-conflict" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={className} data-period-row-id={period.id} onClick={onSelect}>
      <button type="button" className="period-select-dot" aria-label="选中课次" />
      <input className="period-name-input" value={period.name} onChange={(event) => onChangeName(event.currentTarget.value)} />
      <input
        className="period-time-input"
        value={period.startTime}
        onChange={(event) => onChangeStartTime(event.currentTarget.value)}
      />
      <input className="period-time-input" value={period.endTime} onChange={(event) => onChangeEndTime(event.currentTarget.value)} />
      <span className="period-duration">{formatDuration(period.startTime, period.endTime)}</span>
      <div className="timeline-row-handle" title={blockType === "course" ? "同一课程块内拖动排序" : "占位块不可添加课次"}>
        ⋮⋮
      </div>
      <div className="timeline-row-more">
        <button type="button" onClick={stopAndRun(onMoveUp)} disabled={blockType === "placeholder"} title="上移">
          ↑
        </button>
        <button type="button" onClick={stopAndRun(onMoveDown)} disabled={blockType === "placeholder"} title="下移">
          ↓
        </button>
      </div>
      <button type="button" className="period-delete-button" onClick={stopAndRun(onDelete)} aria-label="删除课次">
        删除
      </button>
    </article>
  );
}

function createDefaultPeriod(
  id: string,
  order: number,
  name = `第${order + 1}节`,
  startTime = "08:00",
  endTime = "08:45",
): BlockPeriodSettings {
  return { id, name, startTime, endTime, order, conflict: false };
}

function findPeriodInBlocks(blockSettings: BlockSettingsState, periodId: string | null): BlockPeriodSettings | null {
  if (!periodId) {
    return null;
  }

  for (const block of blockSettings.blocks) {
    const period = block.periods.find((item) => item.id === periodId);
    if (period) {
      return period;
    }
  }

  return null;
}

function withPeriodOrder(periods: BlockPeriodSettings[]): BlockPeriodSettings[] {
  return periods.map((period, order) => ({ ...period, order }));
}

function shiftTime(time: string, minutes: number): string {
  const total = timeToMinutes(time) + minutes;
  const wrapped = (total + 1440) % 1440;
  const nextHours = Math.floor(wrapped / 60);
  const nextMins = wrapped % 60;
  return `${String(nextHours).padStart(2, "0")}:${String(nextMins).padStart(2, "0")}`;
}

function normalizeBlockConflicts(blockSettings: BlockSettingsState): BlockSettingsState {
  const summary = getConflictSummary(blockSettings);

  return {
    ...blockSettings,
    blocks: blockSettings.blocks.map((block) => ({
      ...block,
      periods: withPeriodOrder(block.periods).map((period) => ({ ...period, conflict: summary.periodIds.has(period.id) })),
    })),
  };
}

function getConflictSummary(blockSettings: BlockSettingsState): ConflictSummary {
  const periodRecords = blockSettings.blocks.flatMap((block, blockIndex) =>
    block.periods.map((period, periodIndex) => ({ block, blockIndex, period, periodIndex })),
  );
  const periodIds = new Set<string>();
  const blockIds = new Set<string>();

  for (let index = 0; index < periodRecords.length; index += 1) {
    const current = periodRecords[index];
    const currentStart = timeToMinutes(current.period.startTime);
    const currentEnd = timeToMinutes(current.period.endTime);

    if (currentEnd <= currentStart) {
      markConflict(current.block.id, current.period.id, blockIds, periodIds);
    }

    const next = periodRecords[index + 1];
    if (!next) {
      continue;
    }

    const nextStart = timeToMinutes(next.period.startTime);
    const nextEnd = timeToMinutes(next.period.endTime);
    if (currentStart > nextStart || currentEnd > nextStart || nextEnd <= nextStart) {
      markConflict(current.block.id, current.period.id, blockIds, periodIds);
      markConflict(next.block.id, next.period.id, blockIds, periodIds);
    }
  }

  return {
    count: periodIds.size,
    firstPeriodId: periodIds.values().next().value ?? null,
    periodIds,
    blockIds,
  };
}

function markConflict(blockId: string, periodId: string, blockIds: Set<string>, periodIds: Set<string>) {
  blockIds.add(blockId);
  periodIds.add(periodId);
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return 0;
  }

  return hours * 60 + minutes;
}

function formatDuration(startTime: string, endTime: string): string {
  const minutes = timeToMinutes(endTime) - timeToMinutes(startTime);
  if (minutes <= 0) {
    return "无效";
  }

  return `${minutes} 分钟`;
}

function formatBlockTimeRange(block: BlockSettings): string {
  const first = block.periods[0];
  const last = block.periods[block.periods.length - 1];
  if (!first || !last) {
    return "未设置时间";
  }

  return `${first.startTime}-${last.endTime}`;
}

function focusPeriod(periodId: string) {
  window.requestAnimationFrame(() => {
    const row = document.querySelector<HTMLElement>(`[data-period-row-id="${periodId}"]`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    row?.querySelector<HTMLInputElement>("input")?.focus();
  });
}

function stopPropagation(event: SyntheticEvent) {
  event.stopPropagation();
}

function stopAndRun(action: () => void) {
  return (event: SyntheticEvent) => {
    event.stopPropagation();
    action();
  };
}
