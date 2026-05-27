import type { CSSProperties, PointerEvent, SyntheticEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkdayMode } from "../../features/schedule/types";
import type {
  AppearanceSettings,
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
  onOpenBlockSettings: (blockId: string, anchorRect?: DOMRect) => void;
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
  { id: "appearance", label: "外观" },
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
  onOpenBlockSettings,
}: SettingsWindowProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label="设置">
      <section className="settings-window settings-window-wide">
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
                onOpenBlockSettings={onOpenBlockSettings}
              />
            )}

            {activeSection === "appearance" && (
              <AppearancePanel settings={settings} onSettingsChange={onSettingsChange} />
            )}
          </main>
        </div>
      </section>
    </div>
  );
}

function AppearancePanel({
  settings,
  onSettingsChange,
}: {
  settings: WidgetSettingsState;
  onSettingsChange: (settings: WidgetSettingsState) => void;
}) {
  const appearance = settings.appearance;
  const radiusOptions = [0, 2, 4, 6, 8, 10, 12, 14, 16];

  const updateAppearance = (patch: Partial<AppearanceSettings>) => {
    onSettingsChange({
      ...settings,
      appearance: { ...appearance, ...patch },
    });
  };

  return (
    <section className="settings-panel-section">
      <h3>外观</h3>
      <p>控制列间距、行间距、分割线与课程块统一外观。</p>

      <div className="appearance-grid">
        <label className="appearance-field">
          <span>列间距</span>
          <div className="appearance-control">
            <input
              type="range"
              min="4"
              max="20"
              value={appearance.columnGap}
              onChange={(event) => updateAppearance({ columnGap: Number(event.currentTarget.value) })}
            />
            <strong>{appearance.columnGap}px</strong>
          </div>
        </label>

        <label className="appearance-field">
          <span>行间距</span>
          <div className="appearance-control">
            <input
              type="range"
              min="0"
              max="8"
              value={appearance.rowDividerHeight}
              onChange={(event) => updateAppearance({ rowDividerHeight: Number(event.currentTarget.value) })}
            />
            <strong>{appearance.rowDividerHeight}px</strong>
          </div>
        </label>

        <label className="appearance-field">
          <span>线型</span>
          <select
            value={appearance.rowDividerStyle}
            onChange={(event) => updateAppearance({ rowDividerStyle: event.currentTarget.value as AppearanceSettings["rowDividerStyle"] })}
          >
            <option value="solid">实线</option>
            <option value="dashed">虚线</option>
            <option value="dotted">点线</option>
          </select>
        </label>

        <label className="appearance-field">
          <span>线色</span>
          <input
            type="color"
            value={appearance.rowDividerColor}
            onChange={(event) => updateAppearance({ rowDividerColor: event.currentTarget.value })}
          />
        </label>

        <label className="appearance-field">
          <span>透明度</span>
          <div className="appearance-control">
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(appearance.rowDividerOpacity * 100)}
              onChange={(event) => updateAppearance({ rowDividerOpacity: Number(event.currentTarget.value) / 100 })}
            />
            <strong>{Math.round(appearance.rowDividerOpacity * 100)}%</strong>
          </div>
        </label>

        <label className="appearance-field">
          <span>粗细</span>
          <div className="appearance-control">
            <input
              type="range"
              min="1"
              max="3"
              step="0.5"
              value={appearance.rowDividerThickness}
              onChange={(event) => updateAppearance({ rowDividerThickness: Number(event.currentTarget.value) })}
            />
            <strong>{appearance.rowDividerThickness}px</strong>
          </div>
        </label>

        <label className="appearance-field">
          <span>课程卡片背景色</span>
          <input
            type="color"
            value={appearance.blockCardBackgroundColor}
            onChange={(event) => updateAppearance({ blockCardBackgroundColor: event.currentTarget.value })}
          />
        </label>

        <label className="appearance-field">
          <span>课程卡片圆角</span>
          <select
            value={appearance.blockCardCornerRadius}
            onChange={(event) => updateAppearance({ blockCardCornerRadius: Number(event.currentTarget.value) })}
          >
            {radiusOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="appearance-field">
          <span>块高</span>
          <div className="appearance-block-heights">
            {settings.blockSettings.blocks.map((block, index) => {
              const value = appearance.blockHeights[block.id] ?? (block.type === "placeholder" ? 1.15 : block.periods.length);

              return (
                <div key={block.id} className="appearance-control">
                  <small>{block.name || `块${index + 1}`}</small>
                  <input
                    type="range"
                    min="0.8"
                    max="6"
                    step="0.05"
                    value={value}
                    onChange={(event) =>
                      updateAppearance({
                        blockHeights: {
                          ...appearance.blockHeights,
                          [block.id]: Number(event.currentTarget.value),
                        },
                      })
                    }
                  />
                  <strong>{value.toFixed(2)}fr</strong>
                </div>
              );
            })}
          </div>
        </label>
      </div>
    </section>
  );
}

function BlockSettingsPanel({
  settings,
  onSettingsChange,
  onApplyBlockSettings,
  onOpenBlockSettings,
}: {
  settings: WidgetSettingsState;
  onSettingsChange: (settings: WidgetSettingsState) => void;
  onApplyBlockSettings: (blockSettings: BlockSettingsState) => void;
  onOpenBlockSettings: (blockId: string, anchorRect?: DOMRect) => void;
}) {
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [blockDropTargetId, setBlockDropTargetId] = useState<string | null>(null);
  const [draggingPeriod, setDraggingPeriod] = useState<DraggingPeriod>(null);
  const [periodDropTargetId, setPeriodDropTargetId] = useState<string | null>(null);

  const blockSettings = useMemo(() => normalizeBlockConflicts(settings.blockSettings), [settings.blockSettings]);
  const settingsRef = useRef(settings);
  const blockSettingsRef = useRef(blockSettings);
  const draggingBlockIdRef = useRef(draggingBlockId);
  const draggingPeriodRef = useRef(draggingPeriod);
  const activeBlock = blockSettings.blocks.find((block) => block.id === blockSettings.activeBlockId) ?? blockSettings.blocks[0] ?? null;
  const activePeriod = findPeriodInBlocks(blockSettings, blockSettings.activePeriodId) ?? activeBlock?.periods[0] ?? null;
  const conflictSummary = getConflictSummary(blockSettings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    blockSettingsRef.current = blockSettings;
  }, [blockSettings]);

  useEffect(() => {
    draggingBlockIdRef.current = draggingBlockId;
  }, [draggingBlockId]);

  useEffect(() => {
    draggingPeriodRef.current = draggingPeriod;
  }, [draggingPeriod]);

  const commitBlockSettings = (nextBlockSettings: BlockSettingsState) => {
    const normalizedBlockSettings = normalizeBlockConflicts(nextBlockSettings);
    const nextSettings = { ...settingsRef.current, blockSettings: normalizedBlockSettings };
    blockSettingsRef.current = normalizedBlockSettings;
    settingsRef.current = nextSettings;
    onSettingsChange(nextSettings);
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
    const currentBlock = blockSettings.blocks.find((block) => block.id === blockId);
    const nextType = patch.type ?? currentBlock?.type;
    const nextPeriods =
      nextType === "placeholder"
        ? [currentBlock?.periods[0] ?? createDefaultPeriod(`${blockId}-p1`, 0)]
        : currentBlock?.periods ?? [];

    commitBlockSettings({
      ...blockSettings,
      blocks: blockSettings.blocks.map((block) => {
        if (block.id !== blockId) {
          return block;
        }

        return { ...block, ...patch, periods: withPeriodOrder(nextPeriods) } as BlockSettings;
      }),
      activeBlockId: blockId,
      activePeriodId: nextPeriods[0]?.id ?? null,
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
            name: "",
            type: "course",
            cardBackgroundColor: "#fff8e1",
            cardCornerRadius: 10,
            periods: [createDefaultPeriod(`${nextId}-p1`, 0)],
          }
        : {
            id: nextId,
            name: "",
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
    const message =
      block.type === "placeholder"
        ? "占位块只能包含一个课次，删除后将同时删除整个占位块。如果该课次中已有课程卡片，删除后可能影响原课程表内容。是否继续？"
        : deletesBlock
          ? "该块只剩 1 个课次，删除后将同时删除整个块。如果该课次中已有课程卡片，删除后可能影响原课程表内容。是否继续？"
          : `确认删除「${period.name || "课次"}」？如果该课次中已有课程卡片，删除后可能影响原课程表内容。是否继续？`;

    if (!window.confirm(message)) {
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
    const currentBlockSettings = blockSettingsRef.current;
    const block = currentBlockSettings.blocks.find((item) => item.id === blockId);
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
    const currentBlockSettings = blockSettingsRef.current;
    commitBlockSettings({
      ...currentBlockSettings,
      activeBlockId: blockId,
      activePeriodId,
      blocks: currentBlockSettings.blocks.map((current) =>
        current.id === blockId && current.type === "course" ? { ...current, periods: withPeriodOrder(periods) } : current,
      ),
    });
  };

  const moveBlockToIndex = (blockId: string, targetIndex: number) => {
    const currentBlockSettings = blockSettingsRef.current;
    const index = currentBlockSettings.blocks.findIndex((block) => block.id === blockId);
    if (index < 0 || targetIndex < 0 || targetIndex >= currentBlockSettings.blocks.length || index === targetIndex) {
      return;
    }

    const nextBlocks = [...currentBlockSettings.blocks];
    const [item] = nextBlocks.splice(index, 1);
    nextBlocks.splice(targetIndex, 0, item);
    commitBlockSettings({ ...currentBlockSettings, blocks: nextBlocks, activeBlockId: blockId });
  };

  useEffect(() => {
    if (!draggingBlockId && !draggingPeriod) {
      return;
    }

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!target) {
        return;
      }

      const currentDraggingBlockId = draggingBlockIdRef.current;
      if (currentDraggingBlockId) {
        const targetBlockElement = target.closest<HTMLElement>("[data-block-card-id]");
        const targetBlockId = targetBlockElement?.dataset.blockCardId;
        if (!targetBlockId || targetBlockId === currentDraggingBlockId) {
          setBlockDropTargetId(targetBlockId ?? null);
          return;
        }

        const targetIndex = blockSettingsRef.current.blocks.findIndex((block) => block.id === targetBlockId);
        const sourceIndex = blockSettingsRef.current.blocks.findIndex((block) => block.id === currentDraggingBlockId);
        if (targetIndex >= 0 && sourceIndex >= 0 && shouldReorderByPointer(event.clientY, targetBlockElement, sourceIndex, targetIndex)) {
          setBlockDropTargetId(targetBlockId);
          moveBlockToIndex(currentDraggingBlockId, targetIndex);
        }
        return;
      }

      const currentDraggingPeriod = draggingPeriodRef.current;
      if (!currentDraggingPeriod) {
        return;
      }

      const targetPeriodElement = target.closest<HTMLElement>("[data-period-row-id]");
      const targetPeriodId = targetPeriodElement?.dataset.periodRowId;
      const targetBlockId = targetPeriodElement?.dataset.periodBlockId;
      if (!targetPeriodId || targetBlockId !== currentDraggingPeriod.blockId) {
        setPeriodDropTargetId(null);
        return;
      }

      if (targetPeriodId === currentDraggingPeriod.periodId) {
        setPeriodDropTargetId(targetPeriodId);
        return;
      }

      setPeriodDropTargetId(targetPeriodId);
      const currentBlock = blockSettingsRef.current.blocks.find((block) => block.id === currentDraggingPeriod.blockId);
      const sourceIndex = currentBlock?.periods.findIndex((period) => period.id === currentDraggingPeriod.periodId) ?? -1;
      const targetIndex = currentBlock?.periods.findIndex((period) => period.id === targetPeriodId) ?? -1;
      if (currentBlock && sourceIndex >= 0 && targetIndex >= 0 && shouldReorderByPointer(event.clientY, targetPeriodElement, sourceIndex, targetIndex)) {
        movePeriodToTarget(currentDraggingPeriod.blockId, currentDraggingPeriod.periodId, targetPeriodId);
      }
    };

    const endDrag = () => {
      setDraggingBlockId(null);
      setBlockDropTargetId(null);
      setDraggingPeriod(null);
      setPeriodDropTargetId(null);
      draggingBlockIdRef.current = null;
      draggingPeriodRef.current = null;
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
    };
  }, [draggingBlockId, draggingPeriod]);

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
          <button type="button" className="toolbar-action" onClick={() => addBlock("course")}>添加课程块</button>
        </div>
        <div className="block-settings-toolbar-right">
          <button type="button" className="toolbar-action primary" onClick={applyChanges}>应用修改</button>
        </div>
      </div>

      <div className="block-container-list">
        {blockSettings.blocks.map((block, blockIndex) => {
          const isSelected = block.id === activeBlock?.id;
          const hasConflict = conflictSummary.blockIds.has(block.id);

          return (
            <article
              key={block.id}
              data-block-card-id={block.id}
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
            >
              <BlockHeaderRow
                blockId={block.id}
                blockName={block.name || `块${blockIndex + 1}`}
                blockType={block.type}
                onOpenBlockSettings={onOpenBlockSettings}
                onDragHandlePointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDraggingBlockId(block.id);
                  setBlockDropTargetId(block.id);
                  draggingBlockIdRef.current = block.id;
                }}
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
                      onDragHandlePointerDown={(event) => {
                        if (block.type === "placeholder") {
                          event.preventDefault();
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        setDraggingPeriod({ blockId: block.id, periodId: period.id });
                        setPeriodDropTargetId(period.id);
                        draggingPeriodRef.current = { blockId: block.id, periodId: period.id };
                      }}
                      onDelete={() => deletePeriod(block.id, period.id)}
                      onAddBelow={() => addPeriodToBlock(block.id, period.id)}
                    />
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function BlockHeaderRow({
  blockId,
  blockName,
  blockType,
  onOpenBlockSettings,
  onDragHandlePointerDown,
}: {
  blockId: string;
  blockName: string;
  blockType: BlockType;
  onOpenBlockSettings: (blockId: string, anchorRect?: DOMRect) => void;
  onDragHandlePointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="block-container-header">
      <button
        type="button"
        className="block-name-button"
        title="点击修改块名和类型"
        onClick={(event) => {
          event.stopPropagation();
          console.info("block name clicked", { blockId });
          onOpenBlockSettings(blockId, event.currentTarget.getBoundingClientRect());
        }}
      >
        <span className="block-name-text">{blockName}</span>
        <small>{blockType === "course" ? "课程块" : "占位块"}</small>
      </button>
      <button
        type="button"
        className="block-settings-icon-button"
        aria-label="块拖动"
        onPointerDown={onDragHandlePointerDown}
      >
        ⋮⋮
      </button>
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
  onDragHandlePointerDown,
  onDelete,
  onAddBelow,
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
  onDragHandlePointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onDelete: () => void;
  onAddBelow: () => void;
}) {
  const className = ["period-row", selected ? "is-selected" : "", conflict ? "is-conflict" : "", dragging ? "is-dragging" : "", dropTarget ? "is-drop-target" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={className}
      data-period-row-id={period.id}
      data-period-block-id={block.id}
      role="listitem"
      onClick={onSelect}
    >
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
        title={block.type === "course" ? "同一课程块内拖动排序" : "占位块只有一个课次"}
        onPointerDown={onDragHandlePointerDown}
        onClick={stopPropagation}
      >
        ⋮⋮
      </button>
      {block.type === "course" && (
        <button
          type="button"
          className="period-add-button"
          aria-label="在此行下方添加课次"
          onClick={stopAndRun(onAddBelow)}
          title="在此行下方添加课次"
        >
          +
        </button>
      )}
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

function shouldReorderByPointer(pointerY: number, targetElement: HTMLElement, sourceIndex: number, targetIndex: number): boolean {
  const rect = targetElement.getBoundingClientRect();
  const middleY = rect.top + rect.height / 2;

  if (sourceIndex < targetIndex) {
    return pointerY > middleY;
  }

  return pointerY < middleY;
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
  const periodRecords = blockSettings.blocks.flatMap((block) => block.periods.map((period) => ({ block, period })));
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
