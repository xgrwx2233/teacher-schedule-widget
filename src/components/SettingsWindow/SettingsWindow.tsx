import type { CSSProperties, PointerEvent, SyntheticEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import courseRowIcon from "../../../images/course-row.svg";
import deleteIcon from "../../../images/delete.svg";
import dragIcon from "../../../images/drag.svg";
import mergedRowIcon from "../../../images/merged-row.svg";
import type { WorkdayMode } from "../../features/schedule/types";
import type {
  AppearanceSettings,
  BlockPeriodSettings,
  BlockRowType,
  BlockSettings,
  BlockSettingsState,
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
};

type DraggingPeriod = { blockId: string; periodId: string } | null;
type PeriodEditor = { blockId: string; periodId: string; name: string; startTime: string; endTime: string } | null;
type SettingsIconName =
  | "calendar"
  | "book"
  | "grid"
  | "palette"
  | "plus"
  | "trash"
  | "drag"
  | "sun"
  | "cloudSun"
  | "cup"
  | "courseRow"
  | "mergedRow";

const sectionItems: Array<{ id: SettingsSection; label: string; icon: SettingsIconName }> = [
  { id: "workdays", label: "工作日", icon: "calendar" },
  { id: "term", label: "学期", icon: "book" },
  { id: "blocks", label: "课程块", icon: "grid" },
  { id: "appearance", label: "外观", icon: "palette" },
];

const workdayOptions: Array<{ id: WorkdayMode; label: string; description: string }> = [
  { id: "mon-fri", label: "周一到周五", description: "日期栏显示周一到周五。" },
  { id: "mon-sat", label: "周一到周六", description: "日期栏显示周一到周六。" },
  { id: "mon-sun", label: "周一到周日", description: "日期栏显示周一到周日。" },
];

export function SettingsWindow({
  open,
  activeSection,
  settings,
  computedWeek,
  onActiveSectionChange,
  onSettingsChange,
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
              <SidebarNavItem
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={item.id === activeSection}
                onClick={() => onActiveSectionChange(item.id)}
              />
            ))}
          </nav>

          <main className="settings-content">
            {activeSection === "workdays" && (
              <section className="settings-panel-section">
                <h3>工作日</h3>
                <p>控制日期栏显示范围。</p>
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

            {activeSection === "blocks" && <BlockSettingsPanel settings={settings} onSettingsChange={onSettingsChange} />}

            {activeSection === "appearance" && <AppearancePanel settings={settings} onSettingsChange={onSettingsChange} />}
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
  const updateAppearance = (patch: Partial<AppearanceSettings>) => {
    onSettingsChange({ ...settings, appearance: { ...appearance, ...patch } });
  };

  return (
    <section className="settings-panel-section">
      <h3>外观</h3>
      <p>控制列间距、行间距、分割线与课程块统一外观。</p>
      <div className="appearance-grid">
        <RangeField label="列间距" min={4} max={20} value={appearance.columnGap} suffix="px" onChange={(columnGap) => updateAppearance({ columnGap })} />
        <RangeField label="行间距" min={0} max={8} value={appearance.rowDividerHeight} suffix="px" onChange={(rowDividerHeight) => updateAppearance({ rowDividerHeight })} />
        <label className="appearance-field">
          <span>线型</span>
          <select value={appearance.rowDividerStyle} onChange={(event) => updateAppearance({ rowDividerStyle: event.currentTarget.value as AppearanceSettings["rowDividerStyle"] })}>
            <option value="solid">实线</option>
            <option value="dashed">虚线</option>
            <option value="dotted">点线</option>
          </select>
        </label>
        <label className="appearance-field">
          <span>线色</span>
          <input type="color" value={appearance.rowDividerColor} onChange={(event) => updateAppearance({ rowDividerColor: event.currentTarget.value })} />
        </label>
        <RangeField label="透明度" min={0} max={100} value={Math.round(appearance.rowDividerOpacity * 100)} suffix="%" onChange={(value) => updateAppearance({ rowDividerOpacity: value / 100 })} />
        <RangeField label="粗细" min={1} max={3} step={0.5} value={appearance.rowDividerThickness} suffix="px" onChange={(rowDividerThickness) => updateAppearance({ rowDividerThickness })} />
        <label className="appearance-field">
          <span>课程卡片背景色</span>
          <input type="color" value={appearance.blockCardBackgroundColor} onChange={(event) => updateAppearance({ blockCardBackgroundColor: event.currentTarget.value })} />
        </label>
        <label className="appearance-field">
          <span>课程卡片圆角</span>
          <select value={appearance.blockCardCornerRadius} onChange={(event) => updateAppearance({ blockCardCornerRadius: Number(event.currentTarget.value) })}>
            {[0, 2, 4, 6, 8, 10, 12, 14, 16].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function SidebarNavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: SettingsIconName;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={active ? "settings-nav-item is-active" : "settings-nav-item"} onClick={onClick}>
      <span className="settings-nav-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span>{label}</span>
    </button>
  );
}

function RangeField({
  label,
  min,
  max,
  step = 1,
  value,
  suffix,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="appearance-field">
      <span>{label}</span>
      <div className="appearance-control">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} />
        <strong>
          {value}
          {suffix}
        </strong>
      </div>
    </label>
  );
}

function BlockSettingsPanel({
  settings,
  onSettingsChange,
}: {
  settings: WidgetSettingsState;
  onSettingsChange: (settings: WidgetSettingsState) => void;
}) {
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [blockDropTargetId, setBlockDropTargetId] = useState<string | null>(null);
  const [draggingPeriod, setDraggingPeriod] = useState<DraggingPeriod>(null);
  const [periodDropTargetId, setPeriodDropTargetId] = useState<string | null>(null);
  const [periodEditor, setPeriodEditor] = useState<PeriodEditor>(null);
  const [addMenu, setAddMenu] = useState<{ blockId: string; afterPeriodId: string | null } | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

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
    const normalized = normalizeBlockConflicts(nextBlockSettings);
    const nextSettings = {
      ...settingsRef.current,
      blockSettings: normalized,
      appearance: { ...settingsRef.current.appearance, blockHeights: buildBlockHeights(normalized) },
    };
    blockSettingsRef.current = normalized;
    settingsRef.current = nextSettings;
    onSettingsChange(nextSettings);
  };

  const addBlock = () => {
    const id = `block-${Date.now()}`;
    const period = createDefaultPeriod(`${id}-p1`, 0);
    commitBlockSettings({
      ...blockSettings,
      activeBlockId: id,
      activePeriodId: period.id,
      blocks: [...blockSettings.blocks, { id, name: "新块", cardBackgroundColor: "#fff8e1", cardCornerRadius: 12, periods: [period] }],
    });
  };

  const updateBlockName = (blockId: string, name: string) => {
    commitBlockSettings({
      ...blockSettings,
      blocks: blockSettings.blocks.map((block) => (block.id === blockId ? { ...block, name } : block)),
    });
  };

  const deleteBlock = (blockId: string) => {
    const blocks = blockSettings.blocks.filter((block) => block.id !== blockId);
    commitBlockSettings({ ...blockSettings, blocks, activeBlockId: blocks[0]?.id ?? null, activePeriodId: blocks[0]?.periods[0]?.id ?? null });
  };

  const updatePeriod = (blockId: string, periodId: string, patch: Partial<BlockPeriodSettings>) => {
    commitBlockSettings({
      ...blockSettings,
      activeBlockId: blockId,
      activePeriodId: periodId,
      blocks: blockSettings.blocks.map((block) =>
        block.id === blockId
          ? { ...block, periods: block.periods.map((period) => (period.id === periodId ? { ...period, ...patch } : period)) }
          : block,
      ),
    });
  };

  const addPeriodToBlock = (blockId: string, afterPeriodId: string | null, type: BlockRowType) => {
    const block = blockSettings.blocks.find((item) => item.id === blockId);
    if (!block) {
      return;
    }

    const anchorIndex = afterPeriodId ? block.periods.findIndex((period) => period.id === afterPeriodId) : block.periods.length - 1;
    const insertIndex = Math.max(0, anchorIndex) + 1;
    const previous = block.periods[Math.max(0, insertIndex - 1)];
    const period = createDefaultPeriod(
      `${block.id}-p${Date.now()}`,
      insertIndex,
      type === "course" ? `第${block.periods.length + 1}节` : "合并行",
      shiftTime(previous?.endTime ?? "08:45", 10),
      shiftTime(previous?.endTime ?? "08:45", type === "course" ? 55 : 120),
      type,
    );
    const periods = [...block.periods];
    periods.splice(insertIndex, 0, period);
    commitBlockSettings({
      ...blockSettings,
      activeBlockId: blockId,
      activePeriodId: period.id,
      blocks: blockSettings.blocks.map((item) => (item.id === blockId ? { ...item, periods: withPeriodOrder(periods) } : item)),
    });
    setAddMenu(null);
  };

  const deletePeriod = (blockId: string, periodId: string) => {
    const block = blockSettings.blocks.find((item) => item.id === blockId);
    if (!block) {
      return;
    }
    const periods = block.periods.filter((period) => period.id !== periodId);
    commitBlockSettings({
      ...blockSettings,
      activeBlockId: blockId,
      activePeriodId: periods[0]?.id ?? null,
      blocks: blockSettings.blocks.map((item) => (item.id === blockId ? { ...item, periods: withPeriodOrder(periods) } : item)),
    });
  };

  const selectBlock = (blockId: string) => {
    const block = blockSettings.blocks.find((item) => item.id === blockId);
    if (block) {
      commitBlockSettings({ ...blockSettings, activeBlockId: block.id, activePeriodId: block.periods[0]?.id ?? null });
    }
  };

  const selectPeriod = (blockId: string, periodId: string) => {
    commitBlockSettings({ ...blockSettings, activeBlockId: blockId, activePeriodId: periodId });
  };

  const moveBlockToIndex = (blockId: string, targetIndex: number) => {
    const current = blockSettingsRef.current;
    const sourceIndex = current.blocks.findIndex((block) => block.id === blockId);
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= current.blocks.length || sourceIndex === targetIndex) {
      return;
    }
    const blocks = [...current.blocks];
    const [item] = blocks.splice(sourceIndex, 1);
    blocks.splice(targetIndex, 0, item);
    commitBlockSettings({ ...current, blocks, activeBlockId: blockId });
  };

  const movePeriodToTarget = (blockId: string, periodId: string, targetPeriodId: string) => {
    const current = blockSettingsRef.current;
    const block = current.blocks.find((item) => item.id === blockId);
    if (!block || periodId === targetPeriodId) {
      return;
    }
    const sourceIndex = block.periods.findIndex((period) => period.id === periodId);
    const targetIndex = block.periods.findIndex((period) => period.id === targetPeriodId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }
    const periods = [...block.periods];
    const [item] = periods.splice(sourceIndex, 1);
    periods.splice(targetIndex, 0, item);
    commitBlockSettings({
      ...current,
      activeBlockId: blockId,
      activePeriodId: periodId,
      blocks: current.blocks.map((candidate) => (candidate.id === blockId ? { ...candidate, periods: withPeriodOrder(periods) } : candidate)),
    });
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

      const currentBlockId = draggingBlockIdRef.current;
      if (currentBlockId) {
        const element = target.closest<HTMLElement>("[data-block-card-id]");
        const targetBlockId = element?.dataset.blockCardId;
        if (!element || !targetBlockId || targetBlockId === currentBlockId) {
          setBlockDropTargetId(targetBlockId ?? null);
          return;
        }
        const current = blockSettingsRef.current;
        const sourceIndex = current.blocks.findIndex((block) => block.id === currentBlockId);
        const targetIndex = current.blocks.findIndex((block) => block.id === targetBlockId);
        if (shouldReorderByPointer(event.clientY, element, sourceIndex, targetIndex)) {
          setBlockDropTargetId(targetBlockId);
          moveBlockToIndex(currentBlockId, targetIndex);
        }
        return;
      }

      const currentPeriod = draggingPeriodRef.current;
      if (!currentPeriod) {
        return;
      }

      const element = target.closest<HTMLElement>("[data-period-row-id]");
      const targetPeriodId = element?.dataset.periodRowId;
      const targetBlockId = element?.dataset.periodBlockId;
      if (!element || !targetPeriodId || targetBlockId !== currentPeriod.blockId) {
        setPeriodDropTargetId(null);
        return;
      }

      setPeriodDropTargetId(targetPeriodId);
      const block = blockSettingsRef.current.blocks.find((item) => item.id === currentPeriod.blockId);
      const sourceIndex = block?.periods.findIndex((period) => period.id === currentPeriod.periodId) ?? -1;
      const targetIndex = block?.periods.findIndex((period) => period.id === targetPeriodId) ?? -1;
      if (shouldReorderByPointer(event.clientY, element, sourceIndex, targetIndex)) {
        movePeriodToTarget(currentPeriod.blockId, currentPeriod.periodId, targetPeriodId);
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

  const openPeriodEditor = (blockId: string, periodId: string) => {
    const period = findPeriodInBlocks(blockSettingsRef.current, periodId);
    if (period) {
      setPeriodEditor({ blockId, periodId, name: period.name, startTime: period.startTime, endTime: period.endTime });
    }
  };

  return (
    <section className="settings-panel-section block-settings-section">
      <div className="block-settings-toolbar timeline-toolbar">
        <div className="block-settings-toolbar-left">
          <button type="button" className="toolbar-action toolbar-action-primary" onClick={addBlock}>
            <span className="toolbar-action-icon" aria-hidden="true">
              <Icon name="plus" />
            </span>
            <span>添加课程块</span>
          </button>
        </div>
      </div>

      <div className="block-container-list">
        {blockSettings.blocks.map((block, index) => {
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
              <BlockHeaderPanel
                block={block}
                fallbackName={`块${index + 1}`}
                editing={editingBlockId === block.id}
                onEditingChange={(editing) => setEditingBlockId(editing ? block.id : null)}
                onRename={(name) => updateBlockName(block.id, name)}
                onDelete={() => deleteBlock(block.id)}
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
                      addMenuOpen={addMenu?.blockId === block.id && addMenu.afterPeriodId === period.id}
                      onSelect={() => selectPeriod(block.id, period.id)}
                      onOpenEditor={() => openPeriodEditor(block.id, period.id)}
                      onToggleAddMenu={() =>
                        setAddMenu((current) =>
                          current?.blockId === block.id && current.afterPeriodId === period.id ? null : { blockId: block.id, afterPeriodId: period.id },
                        )
                      }
                      onAddBelow={(type) => addPeriodToBlock(block.id, period.id, type)}
                      onDragHandlePointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDraggingPeriod({ blockId: block.id, periodId: period.id });
                        setPeriodDropTargetId(period.id);
                        draggingPeriodRef.current = { blockId: block.id, periodId: period.id };
                      }}
                      onDelete={() => deletePeriod(block.id, period.id)}
                    />
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {periodEditor && (
        <PeriodEditDialog
          value={periodEditor}
          onClose={() => setPeriodEditor(null)}
          onApply={(patch) => {
            updatePeriod(periodEditor.blockId, periodEditor.periodId, patch);
            setPeriodEditor(null);
          }}
        />
      )}
    </section>
  );
}

function BlockHeaderPanel({
  block,
  fallbackName,
  editing,
  onEditingChange,
  onRename,
  onDelete,
  onDragHandlePointerDown,
}: {
  block: BlockSettings;
  fallbackName: string;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDragHandlePointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  const [draft, setDraft] = useState(block.name || fallbackName);
  useEffect(() => setDraft(block.name || fallbackName), [block.name, fallbackName]);
  const commit = () => {
    onEditingChange(false);
    onRename(draft.trim());
  };

  return (
    <div className="block-header-panel">
      <div className="block-summary">
        <button
          type="button"
          className="block-name-button"
          title="双击修改块名"
          onClick={stopPropagation}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onEditingChange(true);
          }}
        >
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit();
                if (event.key === "Escape") onEditingChange(false);
              }}
            />
          ) : (
            <span className="block-name-text">{block.name || fallbackName}</span>
          )}
        </button>
      </div>

      <div className="block-actions">
        <IconButton kind="delete" label="删除整块" onClick={stopAndRun(onDelete)} />
        <IconButton kind="drag" label="块拖动" onPointerDown={onDragHandlePointerDown} />
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
  addMenuOpen,
  onSelect,
  onOpenEditor,
  onToggleAddMenu,
  onAddBelow,
  onDragHandlePointerDown,
  onDelete,
}: {
  block: BlockSettings;
  period: BlockPeriodSettings;
  selected: boolean;
  conflict: boolean;
  dragging: boolean;
  dropTarget: boolean;
  addMenuOpen: boolean;
  onSelect: () => void;
  onOpenEditor: () => void;
  onToggleAddMenu: () => void;
  onAddBelow: (type: BlockRowType) => void;
  onDragHandlePointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onDelete: () => void;
}) {
  const className = ["period-row", selected ? "is-selected" : "", conflict ? "is-conflict" : "", dragging ? "is-dragging" : "", dropTarget ? "is-drop-target" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={className} data-period-row-id={period.id} data-period-block-id={block.id} role="listitem" onClick={onSelect}>
      <button type="button" className="period-card period-card-inline" onClick={stopPropagation} onDoubleClick={onOpenEditor}>
        <strong>{period.name}</strong>
        <span>
          {period.startTime}-{period.endTime}
        </span>
      </button>

      <RowTypeBadge type={period.type} />

      <div className="period-row-actions">
        <IconButton kind="drag" label="拖动重排" onPointerDown={onDragHandlePointerDown} />
        <div className="period-add-menu-wrap">
          <IconButton kind="add" label="添加课次" onClick={stopAndRun(onToggleAddMenu)} />
          {addMenuOpen && (
            <div className="period-add-menu">
              <button type="button" onClick={stopAndRun(() => onAddBelow("course"))}>
                <RowTypeBadge type="course" compact />
              </button>
              <button type="button" onClick={stopAndRun(() => onAddBelow("merged"))}>
                <RowTypeBadge type="merged" compact />
              </button>
            </div>
          )}
        </div>
        <IconButton kind="delete" label="删除课次" onClick={stopAndRun(onDelete)} />
      </div>
    </article>
  );
}

function RowTypeBadge({ type, compact = false }: { type: BlockRowType; compact?: boolean }) {
  return (
    <span className={["row-type-badge", type === "course" ? "row-type-course" : "row-type-merged", compact ? "is-compact" : ""].filter(Boolean).join(" ")}>
      <img src={type === "course" ? courseRowIcon : mergedRowIcon} alt="" aria-hidden="true" />
      <span>{type === "course" ? "课程行" : "合并行"}</span>
    </span>
  );
}

function IconButton({
  kind,
  label,
  onClick,
  onPointerDown,
}: {
  kind: "add" | "delete" | "drag";
  label: string;
  onClick?: (event: SyntheticEvent) => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={["ui-icon-button", `ui-icon-button-${kind}`].join(" ")}
      aria-label={label}
      title={label}
      onClick={onClick ?? stopPropagation}
      onPointerDown={onPointerDown}
    >
      {kind === "add" ? (
        <Icon name="plus" />
      ) : (
        <img src={kind === "delete" ? deleteIcon : dragIcon} alt="" aria-hidden="true" />
      )}
    </button>
  );
}

function Icon({ name }: { name: SettingsIconName }) {
  switch (name) {
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5.5" width="16" height="14" rx="3" />
          <path d="M8 3.5v4M16 3.5v4M4 10h16" />
          <path d="M8 13h2M12 13h2M8 16h2M12 16h2" />
        </svg>
      );
    case "book":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 4.5h9a3 3 0 0 1 3 3v12H9a3 3 0 0 0-3 3V4.5Z" />
          <path d="M6 4.5a3 3 0 0 0-3 3v12a3 3 0 0 1 3-3h6" />
        </svg>
      );
    case "grid":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="6" height="6" rx="1.5" />
          <rect x="14" y="4" width="6" height="6" rx="1.5" />
          <rect x="4" y="14" width="6" height="6" rx="1.5" />
          <rect x="14" y="14" width="6" height="6" rx="1.5" />
        </svg>
      );
    case "palette":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4.5a8 8 0 1 0 0 16h2.2a1.8 1.8 0 0 0 1.8-1.8 1.2 1.2 0 0 1 1.2-1.2H18a3.5 3.5 0 0 0 0-7h-1a1.8 1.8 0 0 1-1.8-1.8A4.2 4.2 0 0 0 12 4.5Z" />
          <circle cx="8.2" cy="9" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="11.2" cy="7.4" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="15" cy="8.4" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "plus":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      );
    case "trash":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6.5h6M10 6.5l.5-1.5h3L14 6.5M7.5 8h9l-.8 10a1.5 1.5 0 0 1-1.5 1.5H9.8A1.5 1.5 0 0 1 8.3 18L7.5 8Z" />
          <path d="M10 11v5M14 11v5" />
        </svg>
      );
    case "drag":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="8" cy="6" r="1.2" />
          <circle cx="16" cy="6" r="1.2" />
          <circle cx="8" cy="12" r="1.2" />
          <circle cx="16" cy="12" r="1.2" />
          <circle cx="8" cy="18" r="1.2" />
          <circle cx="16" cy="18" r="1.2" />
        </svg>
      );
    case "sun":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
        </svg>
      );
    case "cloudSun":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="8" r="2.2" />
          <path d="M6.2 17.5h9.7a3 3 0 0 0 .5-6 4.8 4.8 0 0 0-9.2 1.3 2.9 2.9 0 0 0-1 4.7Z" />
        </svg>
      );
    case "cup":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 9h10v4.5a5 5 0 0 1-5 5h0a5 5 0 0 1-5-5V9Z" />
          <path d="M17 10.5h1.2a1.8 1.8 0 0 1 0 3.6H17" />
          <path d="M8 18.5h8" />
        </svg>
      );
    case "courseRow":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="7" width="3" height="10" rx="0.8" />
          <rect x="8.5" y="7" width="3" height="10" rx="0.8" />
          <rect x="13" y="7" width="3" height="10" rx="0.8" />
          <rect x="17.5" y="7" width="3" height="10" rx="0.8" />
        </svg>
      );
    case "mergedRow":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="8" width="16" height="8" rx="2" />
        </svg>
      );
  }
}

function PeriodEditDialog({
  value,
  onClose,
  onApply,
}: {
  value: Exclude<PeriodEditor, null>;
  onClose: () => void;
  onApply: (patch: Pick<BlockPeriodSettings, "name" | "startTime" | "endTime">) => void;
}) {
  const [name, setName] = useState(value.name);
  const [startTime, setStartTime] = useState(value.startTime);
  const [endTime, setEndTime] = useState(value.endTime);

  useEffect(() => {
    setName(value.name);
    setStartTime(value.startTime);
    setEndTime(value.endTime);
  }, [value]);

  return (
    <div className="overlay-dialog" role="dialog" aria-modal="true" aria-label="编辑课次">
      <section className="period-edit-dialog">
        <header className="period-edit-header">
          <strong>编辑课次</strong>
          <button type="button" className="block-delete-button" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="period-edit-body">
          <label>
            <span>课次名</span>
            <input value={name} onChange={(event) => setName(event.currentTarget.value)} />
          </label>
          <label>
            <span>开始</span>
            <input value={startTime} onChange={(event) => setStartTime(event.currentTarget.value)} />
          </label>
          <label>
            <span>结束</span>
            <input value={endTime} onChange={(event) => setEndTime(event.currentTarget.value)} />
          </label>
        </div>
        <div className="period-edit-actions">
          <button type="button" className="toolbar-action" onClick={onClose}>
            取消
          </button>
          <button type="button" className="toolbar-action primary" onClick={() => onApply({ name, startTime, endTime })}>
            确定
          </button>
        </div>
      </section>
    </div>
  );
}

function createDefaultPeriod(
  id: string,
  order: number,
  name = `第${order + 1}节`,
  startTime = "08:00",
  endTime = "08:45",
  type: BlockRowType = "course",
): BlockPeriodSettings {
  return { id, name, startTime, endTime, order, conflict: false, type };
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

function getConflictSummary(blockSettings: BlockSettingsState) {
  const records = blockSettings.blocks.flatMap((block) => block.periods.map((period) => ({ block, period })));
  const periodIds = new Set<string>();
  const blockIds = new Set<string>();
  for (let index = 0; index < records.length; index += 1) {
    const current = records[index];
    const currentStart = timeToMinutes(current.period.startTime);
    const currentEnd = timeToMinutes(current.period.endTime);
    if (currentEnd <= currentStart) markConflict(current.block.id, current.period.id, blockIds, periodIds);
    const next = records[index + 1];
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
  return { firstPeriodId: periodIds.values().next().value ?? null, periodIds, blockIds };
}

function markConflict(blockId: string, periodId: string, blockIds: Set<string>, periodIds: Set<string>) {
  blockIds.add(blockId);
  periodIds.add(periodId);
}

function buildBlockHeights(blockSettings: BlockSettingsState): Record<string, number> {
  return Object.fromEntries(blockSettings.blocks.map((block) => [block.id, Math.max(1, block.periods.length)]));
}

function shouldReorderByPointer(pointerY: number, targetElement: HTMLElement, sourceIndex: number, targetIndex: number): boolean {
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return false;
  }
  const rect = targetElement.getBoundingClientRect();
  const middleY = rect.top + rect.height / 2;
  return sourceIndex < targetIndex ? pointerY > middleY : pointerY < middleY;
}

function shiftTime(time: string, minutes: number): string {
  const total = timeToMinutes(time) + minutes;
  const wrapped = (total + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
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
