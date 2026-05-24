import type { CSSProperties, DragEvent, PointerEvent, SyntheticEvent } from "react";
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

type DraggingPeriod = {
  blockId: string;
  periodId: string;
} | null;

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
              <p>修改后将同步到教师课程表挂件。</p>
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
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [blockDropTargetId, setBlockDropTargetId] = useState<string | null>(null);
  const [draggingPeriod, setDraggingPeriod] = useState<DraggingPeriod>(null);
  const [periodDropTargetId, setPeriodDropTargetId] = useState<string | null>(null);

  const blockSettings = useMemo(() => normalizeBlockConflicts(settings.blockSettings), [settings.blockSettings]);
  const activeBlock = blockSettings.blocks.find((block) => block.id === blockSettings.activeBlockId) ?? blockSettings.blocks[0] ?? null;
  const activePeriod = findPeriodInBlocks(blockSettings, blockSettings.activePeriodId) ?? activeBlock?.periods[0] ?? null;
  const conflictSummary = getConflictSummary(blockSettings);

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
    patch: Partial<Pick<BlockSettings, "name" | "type" | "cardBackgroundColor" | "cardCornerRadius">>,
  ) => {
    commitBlockSettings({
      ...blockSettings,
      blocks: blockSettings.blocks.map((block) => {
        if (block.id !== blockId) {
          return block;
        }

        const nextType = patch.type ?? block.type;
        const nextPeriods = nextType === "placeholder" ? [block.periods[0] ?? createDefaultPeriod(`${block.id}-p1`, 0)] : block.periods;
        return { ...block, ...patch, periods: withPeriodOrder(nextPeriods) } as BlockSettings;
      }),
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
            periods: [createDefaultPeriod(`${nextId}-p1`, 0, "占位", "12:00", "14:00")],
          };

    commitBlockSettings({
      ...blockSettings,
      activeBlockId: nextBlock.id,
      activePeriodId: nextBlock.periods[0]?.id ?? null,
      blocks: [...blockSettings.blocks, nextBlock],
    });
  };

  const addPeriodToBlock = (blockId: string, afterPeriodId: string | null) => {
    const targetBlock = blockSettings.blocks.find((block) => block.id === blockId);
    if (!targetBlock || targetBlock.type !== "course") {
      return;
    }

    const activeIndex = afterPeriodId ? targetBlock.periods.findIndex((period) => period.id === afterPeriodId) : targetBlock.periods.length - 1;
    const insertIndex = Math.max(0, activeIndex) + 1;
    const previous = targetBlock.periods[Math.max(0, insertIndex - 1)];
    const nextPeriod = createDefaultPeriod(
      `${targetBlock.id}-p${Date.now()}`,
      insertIndex,
      `第${targetBlock.periods.length + 1}节`,
      shiftTime(previous?.endTime ?? "08:45", 10),
      shiftTime(previous?.endTime ?? "08:45", 55),
    );

    commitBlockSettings({
      ...blockSettings,
      activeBlockId: blockId,
      activePeriodId: nextPeriod.id,
      blocks: blockSettings.blocks.map((block) => {
        if (block.id !== blockId || block.type !== "course") {
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
    const baseMessage =
      block.type === "placeholder"
        ? "占位块只能包含一个课次，删除后将同时删除整个占位块。"
        : deletesBlock
          ? "该块只剩 1 个课次，删除后将同时删除整个块。"
          : `确认删除「${period.name || "课次"}」？`;

    if (!window.confirm(baseMessage)) {
      return;
    }

    if (!window.confirm("如果该课次中已有课程卡片，删除后可能影响原课程表内容。是否继续？")) {
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

    const nextPeriods = block.periods.filter((item) => item.id !== period.id);
    commitBlockSettings({
      ...blockSettings,
      blocks: blockSettings.blocks.map((current) =>
        current.id === block.id && current.type === "course"
          ? { ...current, periods: withPeriodOrder(nextPeriods) }
          : current,
      ),
      activeBlockId: block.id,
      activePeriodId: nextPeriods[0]?.id ?? null,
    });
  };

  const movePeriodToTarget = (blockId: string, periodId: string, targetPeriodId: string) => {
    const block = blockSettings.blocks.find((item) => item.id === blockId);
    if (!block || block.type !== "course" || periodId === targetPeriodId) {
      return;
    }

    const sourceIndex = block.periods.findIndex((period) => period.id === periodId);
    const targetIndex = block.periods.findIndex((period) => period.id === targetPeriodId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const nextPeriods = [...block.periods];
    const [item] = nextPeriods.splice(sourceIndex, 1);
    nextPeriods.splice(targetIndex, 0, item);
    setPeriodsForBlock(blockId, nextPeriods, periodId);
  };

  const setPeriodsForBlock = (blockId: string, periods: BlockPeriodSettings[], activePeriodId: string) => {
    commitBlockSettings({
      ...blockSettings,
      activeBlockId: blockId,
      activePeriodId,
      blocks: blockSettings.blocks.map((current) =>
        current.id === blockId && current.type === "course" ? { ...current, periods: withPeriodOrder(periods) } : current,
      ),
    });
  };

  const moveBlock = (blockId: string, direction: -1 | 1) => {
    const index = blockSettings.blocks.findIndex((block) => block.id === blockId);
    const target = index + direction;
    if (target < 0 || target >= blockSettings.blocks.length) {
      return;
    }

    moveBlockToIndex(blockId, target);
  };

  const moveBlockToIndex = (blockId: string, targetIndex: number) => {
    const index = blockSettings.blocks.findIndex((block) => block.id === blockId);
    if (index < 0 || targetIndex < 0 || targetIndex >= blockSettings.blocks.length || index === targetIndex) {
      return;
    }

    const nextBlocks = [...blockSettings.blocks];
    const [item] = nextBlocks.splice(index, 1);
    nextBlocks.splice(targetIndex, 0, item);
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
        </div>
        <div className="block-settings-toolbar-right">
          <button type="button" className="toolbar-action" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="toolbar-action primary" onClick={applyChanges}>
            应用修改
          </button>
        </div>
      </div>

      <div className="block-container-list">
        {blockSettings.blocks.map((block, blockIndex) => {
          const isSelected = block.id === activeBlock?.id;
          const hasConflict = conflictSummary.blockIds.has(block.id);

          return (
            <article
              key={block.id}
              className={[
                "block-container-card",
                isSelected ? "is-selected" : "",
                hasConflict ? "has-conflict" : "",
                draggingBlockId === block.id ? "is-dragging" : "",
                blockDropTargetId === block.id && draggingBlockId !== block.id ? "is-drop-target" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ "--block-accent": hasConflict ? "#dc2626" : block.cardBackgroundColor } as CSSProperties}
              onClick={() => selectBlock(block.id)}
              onDragOver={(event) => {
                if (!draggingBlockId || draggingBlockId === block.id) {
                  return;
                }
                event.preventDefault();
                setBlockDropTargetId(block.id);
              }}
              onDragLeave={() => setBlockDropTargetId(null)}
              onDrop={(event) => {
                event.preventDefault();
                if (draggingBlockId) {
                  moveBlockToIndex(draggingBlockId, blockIndex);
                }
                setDraggingBlockId(null);
                setBlockDropTargetId(null);
              }}
            >
              <BlockHeaderRow
                block={block}
                blockIndex={blockIndex}
                blockCount={blockSettings.blocks.length}
                styleOpen={openStyleBlockId === block.id}
                onToggleStyle={() => setOpenStyleBlockId(openStyleBlockId === block.id ? null : block.id)}
                onRename={(name) => updateBlock(block.id, { name })}
                onChangeType={(type) => updateBlock(block.id, { type })}
                onChangeBackground={(cardBackgroundColor) => updateBlock(block.id, { cardBackgroundColor })}
                onChangeRadius={(cardCornerRadius) => updateBlock(block.id, { cardCornerRadius })}
                onMoveUp={() => moveBlock(block.id, -1)}
                onMoveDown={() => moveBlock(block.id, 1)}
              />

              <div className="block-content-card">
                <div className="block-period-list" role="list">
                  {block.periods.map((period) => (
                    <PeriodRow
                      key={period.id}
                      block={block}
                      period={period}
                      selected={block.id === activeBlock?.id && period.id === activePeriod?.id}
                      conflict={conflictSummary.periodIds.has(period.id)}
                      dragging={draggingPeriod?.periodId === period.id}
                      dropTarget={periodDropTargetId === period.id && draggingPeriod?.periodId !== period.id}
                      onSelect={() => selectPeriod(block.id, period.id)}
                      onChangeName={(name) => updatePeriod(block.id, period.id, { name })}
                      onChangeStartTime={(startTime) => updatePeriod(block.id, period.id, { startTime })}
                      onChangeEndTime={(endTime) => updatePeriod(block.id, period.id, { endTime })}
                      onDragStart={(event) => {
                        if (block.type === "placeholder") {
                          event.preventDefault();
                          return;
                        }
                        setDraggingPeriod({ blockId: block.id, periodId: period.id });
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(event) => {
                        if (!draggingPeriod || draggingPeriod.blockId !== block.id || draggingPeriod.periodId === period.id) {
                          return;
                        }
                        event.preventDefault();
                        setPeriodDropTargetId(period.id);
                      }}
                      onDragEnd={() => {
                        setDraggingPeriod(null);
                        setPeriodDropTargetId(null);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggingPeriod?.blockId === block.id) {
                          movePeriodToTarget(block.id, draggingPeriod.periodId, period.id);
                        }
                        setDraggingPeriod(null);
                        setPeriodDropTargetId(null);
                      }}
                      onDelete={() => deletePeriod(block.id, period.id)}
                    />
                  ))}
                </div>

                {block.type === "course" && (
                  <button
                    type="button"
                    className="block-add-period-button"
                    onClick={stopAndRun(() => addPeriodToBlock(block.id, block.periods[block.periods.length - 1]?.id ?? null))}
                  >
                    + 在当前块中添加课次
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function BlockHeaderRow({
  block,
  blockIndex,
  blockCount,
  styleOpen,
  onToggleStyle,
  onRename,
  onChangeType,
  onChangeBackground,
  onChangeRadius,
  onMoveUp,
  onMoveDown,
}: {
  block: BlockSettings;
  blockIndex: number;
  blockCount: number;
  styleOpen: boolean;
  onToggleStyle: () => void;
  onRename: (name: string) => void;
  onChangeType: (type: BlockType) => void;
  onChangeBackground: (color: string) => void;
  onChangeRadius: (radius: number) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const radiusOptions = [0, 2, 4, 6, 8, 10, 12, 14, 16];

  return (
    <div className="block-container-header">
      <input
        className="block-name-input"
        value={block.name}
        placeholder="块名"
        onChange={(event) => onRename(event.currentTarget.value)}
        onClick={stopPropagation}
      />
      <div className="block-style-area">
        <button className="block-settings-icon-button" type="button" onClick={stopAndRun(onToggleStyle)} aria-label="块设置">
          ⚙
        </button>
        {styleOpen && (
          <div className="style-popover" onClick={stopPropagation}>
            <label>
              <span>块类型</span>
              <select
                className="block-type-select"
                value={block.type}
                onChange={(event) => onChangeType(event.currentTarget.value as BlockType)}
              >
                <option value="course">课程块</option>
                <option value="placeholder">占位块</option>
              </select>
            </label>
            <label>
              <span>块内课程卡片背景色</span>
              <input type="color" value={block.cardBackgroundColor} onChange={(event) => onChangeBackground(event.currentTarget.value)} />
            </label>
            <label className="block-radius-control">
              <span>块内课程卡片圆角</span>
              <select
                value={block.cardCornerRadius}
                onChange={(event) => onChangeRadius(Number(event.currentTarget.value))}
              >
                {radiusOptions.map((radius) => (
                  <option key={radius} value={radius}>
                    {radius}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
      <div className="block-move-buttons">
        <button type="button" onClick={stopAndRun(onMoveUp)} disabled={blockIndex === 0} title="上移块">
          ↑
        </button>
        <button type="button" onClick={stopAndRun(onMoveDown)} disabled={blockIndex === blockCount - 1} title="下移块">
          ↓
        </button>
      </div>
    </div>
  );
}

function PeriodRow({
  block,
  period,
  selected,
  conflict,
  dragging,
  dropTarget,
  onSelect,
  onChangeName,
  onChangeStartTime,
  onChangeEndTime,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onDelete,
}: {
  block: BlockSettings;
  period: BlockPeriodSettings;
  selected: boolean;
  conflict: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onSelect: () => void;
  onChangeName: (name: string) => void;
  onChangeStartTime: (startTime: string) => void;
  onChangeEndTime: (endTime: string) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDelete: () => void;
}) {
  const className = ["period-row", selected ? "is-selected" : "", conflict ? "is-conflict" : "", dragging ? "is-dragging" : "", dropTarget ? "is-drop-target" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={className}
      data-period-row-id={period.id}
      role="listitem"
      onClick={onSelect}
      onDragOver={onDragOver}
      onDragLeave={() => undefined}
      onDrop={onDrop}
    >
      <button type="button" className="period-select-dot" aria-label="选中课次" onClick={stopAndRun(onSelect)} />
      <input
        className="period-name-input"
        value={period.name}
        placeholder="课次名"
        onClick={stopPropagation}
        onChange={(event) => onChangeName(event.currentTarget.value)}
      />
      <input
        className="period-time-input"
        value={period.startTime}
        placeholder="HH:mm"
        onClick={stopPropagation}
        onChange={(event) => onChangeStartTime(event.currentTarget.value)}
      />
      <span className="period-time-separator">-</span>
      <input
        className="period-time-input"
        value={period.endTime}
        placeholder="HH:mm"
        onClick={stopPropagation}
        onChange={(event) => onChangeEndTime(event.currentTarget.value)}
      />
      <button
        type="button"
        className="timeline-row-handle"
        draggable={block.type === "course"}
        title={block.type === "course" ? "同一课程块内拖动排序" : "占位块只有一个课次"}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={stopPropagation}
      >
        ⋮⋮
      </button>
      <button type="button" className="period-delete-button" onClick={stopAndRun(onDelete)} aria-label="删除课次">
        -
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
  const periodRecords = blockSettings.blocks.flatMap((block) =>
    block.periods.map((period) => ({ block, period })),
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
