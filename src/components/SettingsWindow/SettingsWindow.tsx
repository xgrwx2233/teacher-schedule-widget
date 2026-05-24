import type { PointerEvent, SyntheticEvent } from "react";
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
}: {
  settings: WidgetSettingsState;
  onSettingsChange: (settings: WidgetSettingsState) => void;
  onApplyBlockSettings: (blockSettings: BlockSettingsState) => void;
}) {
  const blockSettings = normalizeBlockConflicts(settings.blockSettings);
  const activeBlock = blockSettings.blocks.find((block) => block.id === blockSettings.activeBlockId) ?? blockSettings.blocks[0] ?? null;
  const activePeriod = findPeriodInBlocks(blockSettings, blockSettings.activePeriodId) ?? activeBlock?.periods[0] ?? null;
  const hasConflict = blockSettings.blocks.some((block) => block.periods.some((period) => period.conflict));

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
            cardCornerRadius: 12,
            periods: [createDefaultPeriod(`${nextId}-p1`, 0)],
          }
        : {
            id: nextId,
            name: "新占位块",
            type: "placeholder",
            cardBackgroundColor: "#e3f2fd",
            cardCornerRadius: 12,
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

  const deleteActive = () => {
    if (!activeBlock || !activePeriod) {
      return;
    }

    if (activeBlock.type === "placeholder" || activeBlock.periods.length === 1) {
      const ok = window.confirm("当前课次是该块的唯一课次。继续删除会删除整个块，是否继续？");
      if (!ok) {
        return;
      }

      const nextBlocks = blockSettings.blocks.filter((block) => block.id !== activeBlock.id);
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
      blocks: blockSettings.blocks.map((block) => {
        if (block.id !== activeBlock.id || block.type !== "course") {
          return block;
        }

        return { ...block, periods: withPeriodOrder(block.periods.filter((period) => period.id !== activePeriod.id)) };
      }),
      activePeriodId: activeBlock.periods.find((period) => period.id !== activePeriod.id)?.id ?? null,
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
    if (normalized.blocks.some((block) => block.periods.some((period) => period.conflict))) {
      window.alert("当前课次时间存在重叠，请修正后再应用到小挂件。");
      commitBlockSettings(normalized);
      return;
    }

    onApplyBlockSettings(normalized);
  };

  return (
    <section className="settings-panel-section block-settings-section">
      <div className="block-settings-toolbar">
        <div className="block-settings-toolbar-left">
          <button type="button" className="toolbar-action" onClick={() => addBlock("course")}>
            添加课程块
          </button>
          <button type="button" className="toolbar-action" onClick={() => addBlock("placeholder")}>
            添加占位块
          </button>
          <button type="button" className="toolbar-action primary" onClick={addPeriodAfterActive}>
            添加课次
          </button>
        </div>
        <div className="block-settings-toolbar-right">
          {hasConflict && <span className="block-conflict-hint">存在时间冲突</span>}
          <button type="button" className="toolbar-action" onClick={deleteActive}>
            删除
          </button>
          <button type="button" className="toolbar-action primary" onClick={applyChanges}>
            应用
          </button>
        </div>
      </div>

      <div className="block-settings-layout">
        <section className="block-list-panel">
          <div className="block-panel-header">
            <h3>课程块列</h3>
            <span>当前用上下按钮调整顺序</span>
          </div>
          <div className="block-list">
            {blockSettings.blocks.map((block) => (
              <BlockCard
                key={block.id}
                block={block}
                selected={block.id === activeBlock?.id}
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

        <section className="period-list-panel">
          <div className="block-panel-header">
            <h3>课次列</h3>
            <span>全部块课次展开显示</span>
          </div>
          <div className="period-list">
            {blockSettings.blocks.map((block) => (
              <div className="period-block-group" key={block.id}>
                <div className="period-block-title">
                  <strong>{block.name}</strong>
                  <span>{block.type === "course" ? "课程块" : "占位块"}</span>
                </div>
                {block.periods.map((period) => (
                  <PeriodRow
                    key={period.id}
                    blockType={block.type}
                    period={period}
                    selected={block.id === activeBlock?.id && period.id === activePeriod?.id}
                    conflict={period.conflict}
                    onSelect={() => selectPeriod(block.id, period.id)}
                    onChangeName={(name) => updatePeriod(block.id, period.id, { name })}
                    onChangeStartTime={(startTime) => updatePeriod(block.id, period.id, { startTime })}
                    onChangeEndTime={(endTime) => updatePeriod(block.id, period.id, { endTime })}
                    onMoveUp={() => movePeriod(block.id, period.id, -1)}
                    onMoveDown={() => movePeriod(block.id, period.id, 1)}
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
  onSelect,
  onRename,
  onChangeTone,
  onChangeRadius,
  onMoveUp,
  onMoveDown,
}: {
  block: BlockSettings;
  selected: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onChangeTone: (tone: string) => void;
  onChangeRadius: (radius: number) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <article className={selected ? "block-card is-selected" : "block-card"} onClick={onSelect}>
      <div className="block-card-summary">
        <button type="button" className="block-select-dot" aria-label="选中课程块" />
        <div className="block-card-meta">
          <strong>{block.name}</strong>
          <span>{block.type === "course" ? "课程块" : "占位块"}</span>
        </div>
        <div className="block-card-inline-actions">
          <button type="button" className="mini-action" onClick={stopAndRun(onMoveUp)}>
            ↑
          </button>
          <button type="button" className="mini-action" onClick={stopAndRun(onMoveDown)}>
            ↓
          </button>
        </div>
      </div>
      <div className="block-card-form">
        <label>
          <span>块名</span>
          <input value={block.name} onChange={(event) => onRename(event.currentTarget.value)} onClick={stopPropagation} />
        </label>
        <label>
          <span>卡片背景</span>
          <input
            type="color"
            value={block.cardBackgroundColor}
            onChange={(event) => onChangeTone(event.currentTarget.value)}
            onClick={stopPropagation}
          />
        </label>
        <label>
          <span>圆角 {block.cardCornerRadius}px</span>
          <input
            type="range"
            min="0"
            max="18"
            value={block.cardCornerRadius}
            onChange={(event) => onChangeRadius(Number(event.currentTarget.value))}
            onClick={stopPropagation}
          />
        </label>
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
}) {
  const className = ["period-row", selected ? "is-selected" : "", conflict ? "is-conflict" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={className} onClick={onSelect}>
      <button type="button" className="period-select-dot" aria-label="选中课次" />
      <div className="period-row-main">
        <div className="period-row-label">
          <input value={period.name} onChange={(event) => onChangeName(event.currentTarget.value)} onClick={stopPropagation} />
        </div>
        <div className="period-row-time">
          <input
            value={period.startTime}
            onChange={(event) => onChangeStartTime(event.currentTarget.value)}
            onClick={stopPropagation}
          />
          <span>~</span>
          <input value={period.endTime} onChange={(event) => onChangeEndTime(event.currentTarget.value)} onClick={stopPropagation} />
        </div>
      </div>
      <div className="period-row-actions">
        <span className="period-kind-tag">{blockType === "course" ? "课程块" : "占位块"}</span>
        <button type="button" className="mini-action" onClick={stopAndRun(onMoveUp)} disabled={blockType === "placeholder"}>
          ↑
        </button>
        <button type="button" className="mini-action" onClick={stopAndRun(onMoveDown)} disabled={blockType === "placeholder"}>
          ↓
        </button>
      </div>
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
  const [hoursPart, minutesPart] = time.split(":");
  const hours = Number(hoursPart);
  const mins = Number(minutesPart);
  const total = hours * 60 + mins + minutes;
  const wrapped = (total + 1440) % 1440;
  const nextHours = Math.floor(wrapped / 60);
  const nextMins = wrapped % 60;
  return `${String(nextHours).padStart(2, "0")}:${String(nextMins).padStart(2, "0")}`;
}

function normalizeBlockConflicts(blockSettings: BlockSettingsState): BlockSettingsState {
  const periods = blockSettings.blocks.flatMap((block) => block.periods.map((period) => ({ blockId: block.id, period })));
  const conflicts = new Set<string>();
  const sorted = [...periods].sort((a, b) => timeToMinutes(a.period.startTime) - timeToMinutes(b.period.startTime));

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const currentStart = timeToMinutes(current.period.startTime);
    const currentEnd = timeToMinutes(current.period.endTime);

    if (currentEnd <= currentStart) {
      conflicts.add(current.period.id);
      continue;
    }

    for (let nextIndex = index + 1; nextIndex < sorted.length; nextIndex += 1) {
      const next = sorted[nextIndex];
      const nextStart = timeToMinutes(next.period.startTime);
      const nextEnd = timeToMinutes(next.period.endTime);

      if (nextEnd <= nextStart) {
        conflicts.add(next.period.id);
      }

      if (nextStart >= currentEnd) {
        break;
      }

      if (nextEnd > currentStart) {
        conflicts.add(current.period.id);
        conflicts.add(next.period.id);
      }
    }
  }

  return {
    ...blockSettings,
    blocks: blockSettings.blocks.map((block) => ({
      ...block,
      periods: withPeriodOrder(block.periods).map((period) => ({ ...period, conflict: conflicts.has(period.id) })),
    })),
  };
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return 0;
  }

  return hours * 60 + minutes;
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
