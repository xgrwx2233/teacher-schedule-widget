import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SettingsWindow } from "../components/SettingsWindow/SettingsWindow";
import {
  defaultAppearanceSettings,
  defaultBlockSettingsState,
  type BlockSettingsState,
  type SettingsSection,
  type WidgetSettingsState,
} from "../features/settings/settingsTypes";
import {
  SETTINGS_WINDOW_CLOSE_EVENT,
  SETTINGS_WINDOW_STATE_EVENT,
  SETTINGS_WINDOW_STATE_REQUEST_EVENT,
  SETTINGS_WINDOW_UPDATE_EVENT,
  BLOCK_SETTINGS_WINDOW_LABEL,
  BLOCK_SETTINGS_WINDOW_STATE_EVENT,
  WIDGET_WINDOW_LABEL,
  type BlockSettingsWindowStatePayload,
  type SettingsWindowStatePayload,
  type SettingsWindowUpdatePayload,
} from "../features/settings/windowEvents";

const defaultSettings: WidgetSettingsState = {
  workdayMode: "mon-fri",
  term: {
    startDate: "2026-03-05",
    endDate: "2026-06-30",
  },
  blockSettings: defaultBlockSettingsState,
  appearance: defaultAppearanceSettings,
};

const BLOCK_SETTINGS_WINDOW_WIDTH = 176;
const BLOCK_SETTINGS_WINDOW_HEIGHT = 140;

export function SettingsWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [settings, setSettings] = useState<WidgetSettingsState>(defaultSettings);
  const [activeSection, setActiveSection] = useState<SettingsSection>("workdays");
  const settingsRef = useRef(settings);
  const activeSectionRef = useRef(activeSection);
  const computedWeek = useMemo(() => calculateWeekNumber(settings.term.startDate, new Date()), [settings.term.startDate]);

  const closeWindow = useCallback(async () => {
    const blockSettingsWindow = await WebviewWindow.getByLabel(BLOCK_SETTINGS_WINDOW_LABEL);
    await blockSettingsWindow?.hide();
    await emitTo(WIDGET_WINDOW_LABEL, SETTINGS_WINDOW_CLOSE_EVENT, {
      windowLabel: currentWindow.label,
    });
    await currentWindow.hide();
  }, [currentWindow]);

  useEffect(() => {
    const unlistenState = listen<SettingsWindowStatePayload>(SETTINGS_WINDOW_STATE_EVENT, (event) => {
      settingsRef.current = event.payload.settings;
      activeSectionRef.current = event.payload.activeSection;
      setSettings(event.payload.settings);
      setActiveSection(event.payload.activeSection);
    });

    void emitTo(WIDGET_WINDOW_LABEL, SETTINGS_WINDOW_STATE_REQUEST_EVENT, {
      windowLabel: currentWindow.label,
    });

    return () => {
      void unlistenState.then((unlisten) => unlisten());
    };
  }, [currentWindow.label]);

  useEffect(() => {
    const unlistenPromise = currentWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await closeWindow();
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [closeWindow, currentWindow]);

  const emitUpdate = (nextSettings: WidgetSettingsState, nextSection = activeSection, applyBlockSettings = false) => {
    settingsRef.current = nextSettings;
    activeSectionRef.current = nextSection;
    setSettings(nextSettings);
    setActiveSection(nextSection);
    void emitTo<SettingsWindowUpdatePayload>(WIDGET_WINDOW_LABEL, SETTINGS_WINDOW_UPDATE_EVENT, {
      windowLabel: currentWindow.label,
      settings: nextSettings,
      activeSection: nextSection,
      applyBlockSettings,
    });
  };

  const applyBlockSettings = (blockSettings: BlockSettingsState) => {
    const nextSettings: WidgetSettingsState = {
      ...settingsRef.current,
      blockSettings,
      appearance: {
        ...settingsRef.current.appearance,
        blockHeights: buildBlockHeightsFromBlockSettings(blockSettings),
      },
    };

    emitUpdate(nextSettings, "blocks", true);
  };

  const openBlockSettings = async (blockId: string, anchorRect?: DOMRect) => {
    const nextSettings = settingsRef.current;
    const nextBlockSettings = nextSettings.blockSettings;
    const targetBlock = nextBlockSettings.blocks.find((block) => block.id === blockId);
    if (!targetBlock) {
      return;
    }

    try {
      const updatedSettings: WidgetSettingsState = {
        ...nextSettings,
        blockSettings: {
          ...nextBlockSettings,
          activeBlockId: targetBlock.id,
        },
      };
      console.info("open block settings requested", {
        blockId: targetBlock.id,
        blockName: targetBlock.name,
        blockType: targetBlock.type,
      });
      emitUpdate(updatedSettings, "blocks");
      const payload: BlockSettingsWindowStatePayload = {
        activeBlockId: targetBlock.id,
        block: targetBlock,
        settings: updatedSettings,
      };
      await invoke("set_block_settings_window_state", { payload });
      await invoke("open_block_settings_window");
      await positionBlockSettingsWindow(currentWindow, anchorRect);
      await emitTo<BlockSettingsWindowStatePayload>(BLOCK_SETTINGS_WINDOW_LABEL, BLOCK_SETTINGS_WINDOW_STATE_EVENT, payload);
      window.setTimeout(() => {
        void emitTo<BlockSettingsWindowStatePayload>(BLOCK_SETTINGS_WINDOW_LABEL, BLOCK_SETTINGS_WINDOW_STATE_EVENT, payload);
      }, 120);
    } catch (error) {
      console.error("failed to open block settings window", error);
    }
  };

  return (
    <main className="dialog-window-root">
      <SettingsWindow
        open
        activeSection={activeSection}
        settings={settings}
        computedWeek={computedWeek}
        onActiveSectionChange={(section) => emitUpdate(settings, section)}
        onSettingsChange={(nextSettings) => emitUpdate(nextSettings)}
        onApplyBlockSettings={applyBlockSettings}
        onOpenBlockSettings={openBlockSettings}
      />
    </main>
  );
}

function buildBlockHeightsFromBlockSettings(blockSettings: BlockSettingsState): Record<string, number> {
  return Object.fromEntries(
    blockSettings.blocks.map((block) => [block.id, block.type === "placeholder" ? 1.15 : Math.max(1, block.periods.length)]),
  );
}

async function positionBlockSettingsWindow(settingsWindow: ReturnType<typeof getCurrentWindow>, anchorRect?: DOMRect) {
  const blockSettingsWindow = await WebviewWindow.getByLabel(BLOCK_SETTINGS_WINDOW_LABEL);
  if (!blockSettingsWindow) {
    return;
  }

  const [settingsPosition, settingsSize, scaleFactor] = await Promise.all([
    settingsWindow.outerPosition(),
    settingsWindow.outerSize(),
    settingsWindow.scaleFactor(),
  ]);
  const width = Math.round(BLOCK_SETTINGS_WINDOW_WIDTH * scaleFactor);
  const height = Math.round(BLOCK_SETTINGS_WINDOW_HEIGHT * scaleFactor);
  const margin = Math.round(8 * scaleFactor);
  const screenPadding = Math.round(12 * scaleFactor);
  const anchorLeft = anchorRect ? settingsPosition.x + Math.round(anchorRect.left * scaleFactor) : settingsPosition.x + Math.round((settingsSize.width - width) / 2);
  const anchorTop = anchorRect ? settingsPosition.y + Math.round(anchorRect.top * scaleFactor) : settingsPosition.y;
  const anchorBottom = anchorRect ? settingsPosition.y + Math.round(anchorRect.bottom * scaleFactor) : settingsPosition.y;
  const yAbove = anchorTop - height - margin;
  const x = Math.max(screenPadding, anchorLeft);
  const y = Math.max(screenPadding, yAbove > screenPadding ? yAbove : anchorBottom + margin);

  await blockSettingsWindow.setSize(new PhysicalSize(width, height));
  await blockSettingsWindow.setPosition(new PhysicalPosition(x, y));
}

function calculateWeekNumber(startDate: string, currentDate: Date): number {
  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) {
    return 1;
  }

  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const currentDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()).getTime();
  const diffDays = Math.floor((currentDay - startDay) / 86400000);
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}
