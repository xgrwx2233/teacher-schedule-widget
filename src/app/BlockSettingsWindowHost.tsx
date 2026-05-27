import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useMemo, useRef, useState } from "react";
import { BlockSettingsDialog } from "../components/BlockSettingsWindow/BlockSettingsWindow";
import {
  defaultAppearanceSettings,
  defaultBlockSettingsState,
  type BlockSettings,
  type WidgetSettingsState,
} from "../features/settings/settingsTypes";
import {
  BLOCK_SETTINGS_WINDOW_STATE_EVENT,
  BLOCK_TYPE_CONFIRM_REQUEST_EVENT,
  BLOCK_TYPE_CONFIRM_RESPONSE_EVENT,
  BLOCK_TYPE_CONFIRM_WINDOW_LABEL,
  SETTINGS_WINDOW_LABEL,
  SETTINGS_WINDOW_STATE_EVENT,
  SETTINGS_WINDOW_UPDATE_EVENT,
  WIDGET_WINDOW_LABEL,
  type BlockSettingsWindowStatePayload,
  type BlockTypeConfirmResponsePayload,
  type SettingsWindowStatePayload,
  type SettingsWindowUpdatePayload,
} from "../features/settings/windowEvents";

const defaultSettings: WidgetSettingsState = {
  workdayMode: "mon-fri",
  term: { startDate: "2026-03-05", endDate: "2026-06-30" },
  blockSettings: defaultBlockSettingsState,
  appearance: defaultAppearanceSettings,
};

export function BlockSettingsWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [settings, setSettings] = useState<WidgetSettingsState>(defaultSettings);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  const selectedBlockIdRef = useRef<string | null>(selectedBlockId);
  const confirmResolversRef = useRef(new Map<string, (confirmed: boolean) => void>());

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    selectedBlockIdRef.current = selectedBlockId;
  }, [selectedBlockId]);

  const applyStatePayload = (payload: BlockSettingsWindowStatePayload) => {
    const nextBlockId =
      payload.block?.id ??
      payload.activeBlockId ??
      payload.settings.blockSettings.activeBlockId ??
      selectedBlockIdRef.current ??
      null;

    settingsRef.current = payload.settings;
    selectedBlockIdRef.current = nextBlockId;
    setSelectedBlockId(nextBlockId);
    setSettings({
      ...payload.settings,
      blockSettings: { ...payload.settings.blockSettings, activeBlockId: nextBlockId },
    });
  };

  useEffect(() => {
    const unlistenState = listen<BlockSettingsWindowStatePayload>(BLOCK_SETTINGS_WINDOW_STATE_EVENT, (event) => {
      applyStatePayload(event.payload);
    });

    const loadCachedState = () => {
      void invoke<BlockSettingsWindowStatePayload | null>("get_block_settings_window_state").then((payload) => {
        if (payload) {
          applyStatePayload(payload);
        }
      });
    };

    loadCachedState();
    void currentWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        loadCachedState();
      }
    });

    return () => {
      void unlistenState.then((unlisten) => unlisten());
    };
  }, [currentWindow]);

  useEffect(() => {
    const unlistenClose = currentWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await currentWindow.hide();
    });

    return () => {
      void unlistenClose.then((unlisten) => unlisten());
    };
  }, [currentWindow]);

  useEffect(() => {
    const unlistenResponse = listen<BlockTypeConfirmResponsePayload>(BLOCK_TYPE_CONFIRM_RESPONSE_EVENT, (event) => {
      const resolver = confirmResolversRef.current.get(event.payload.requestId);
      if (!resolver) {
        return;
      }

      resolver(event.payload.confirmed);
      confirmResolversRef.current.delete(event.payload.requestId);
    });

    return () => {
      void unlistenResponse.then((unlisten) => unlisten());
      confirmResolversRef.current.forEach((resolve) => resolve(false));
      confirmResolversRef.current.clear();
    };
  }, []);

  const activeBlock =
    settings.blockSettings.blocks.find((block) => block.id === selectedBlockId) ??
    settings.blockSettings.blocks.find((block) => block.id === settings.blockSettings.activeBlockId) ??
    null;

  const pushSettings = async (nextSettings: WidgetSettingsState) => {
    settingsRef.current = nextSettings;
    setSettings(nextSettings);

    const nextActiveBlock =
      nextSettings.blockSettings.blocks.find((block) => block.id === nextSettings.blockSettings.activeBlockId) ??
      nextSettings.blockSettings.blocks[0] ??
      null;

    if (nextActiveBlock) {
      setSelectedBlockId(nextActiveBlock.id);
      selectedBlockIdRef.current = nextActiveBlock.id;
      await invoke("set_block_settings_window_state", {
        payload: { settings: nextSettings, activeBlockId: nextActiveBlock.id, block: nextActiveBlock },
      });
    }

    await emitTo<SettingsWindowUpdatePayload>(WIDGET_WINDOW_LABEL, SETTINGS_WINDOW_UPDATE_EVENT, {
      windowLabel: currentWindow.label,
      settings: nextSettings,
      activeSection: "blocks",
      applyBlockSettings: false,
    });
    await emitTo<SettingsWindowStatePayload>(SETTINGS_WINDOW_LABEL, SETTINGS_WINDOW_STATE_EVENT, {
      settings: nextSettings,
      activeSection: "blocks",
    });
  };

  const requestBlockTypeConfirm = async (block: BlockSettings) => {
    const requestId = `${block.id}-${Date.now()}`;
    const confirmed = await new Promise<boolean>(async (resolve) => {
      const payload = {
        requestId,
        sourceWindowLabel: currentWindow.label,
        title: "确认切换块类型",
        message: "该课程块中包含" + block.periods.length + "行课次，切换类型会剪切课次，只保留第一节课。",
        detail: block.name || block.id,
      };

      try {
        confirmResolversRef.current.set(requestId, resolve);
        await invoke("set_block_type_confirm_window_state", { payload });
        await invoke("open_block_type_confirm_window");
        await positionBlockTypeConfirmWindow(currentWindow);
        await emitTo(BLOCK_TYPE_CONFIRM_WINDOW_LABEL, BLOCK_TYPE_CONFIRM_REQUEST_EVENT, payload);
      } catch (error) {
        console.error("failed to open block type confirm window", error);
        confirmResolversRef.current.delete(requestId);
        resolve(false);
      }
    });

    confirmResolversRef.current.delete(requestId);
    return confirmed;
  };

  const updateSelectedBlock = (updater: (block: BlockSettings) => BlockSettings): WidgetSettingsState | null => {
    const currentBlock =
      settingsRef.current.blockSettings.blocks.find((block) => block.id === selectedBlockIdRef.current) ?? activeBlock;
    if (!currentBlock) {
      return null;
    }

    const nextBlocks = settingsRef.current.blockSettings.blocks.map((block) =>
      block.id === currentBlock.id ? updater(block) : block,
    );

    selectedBlockIdRef.current = currentBlock.id;
    setSelectedBlockId(currentBlock.id);

    return {
      ...settingsRef.current,
      blockSettings: { ...settingsRef.current.blockSettings, activeBlockId: currentBlock.id, blocks: nextBlocks },
    };
  };

  const onChangeName = (name: string) => {
    const nextSettings = updateSelectedBlock((block) => ({ ...block, name }));
    if (nextSettings) {
      void pushSettings(nextSettings);
    }
  };

  const onChangeType = async (type: BlockSettings["type"]) => {
    const currentBlock =
      settingsRef.current.blockSettings.blocks.find((block) => block.id === selectedBlockIdRef.current) ?? activeBlock;
    if (!currentBlock || currentBlock.type === type) {
      return;
    }

    if (currentBlock.type === "course" && type === "placeholder" && currentBlock.periods.length > 1) {
      const confirmed = await requestBlockTypeConfirm(currentBlock);
      if (!confirmed) {
        return;
      }
    }

    const nextBlock = convertBlockType(currentBlock, type);
    const nextSettings = updateSelectedBlock(() => nextBlock);
    if (!nextSettings) {
      return;
    }

    nextSettings.blockSettings.activePeriodId = nextBlock.periods[0]?.id ?? null;
    void pushSettings(nextSettings);
  };

  return (
    <main className="dialog-window-root">
      {activeBlock && <BlockSettingsDialog block={activeBlock} onChangeName={onChangeName} onChangeType={onChangeType} />}
    </main>
  );
}

async function positionBlockTypeConfirmWindow(settingsWindow: ReturnType<typeof getCurrentWindow>) {
  const confirmWindow = await WebviewWindow.getByLabel(BLOCK_TYPE_CONFIRM_WINDOW_LABEL);
  if (!confirmWindow) {
    return;
  }

  const [settingsPosition, settingsSize, scaleFactor] = await Promise.all([
    settingsWindow.outerPosition(),
    settingsWindow.outerSize(),
    settingsWindow.scaleFactor(),
  ]);

  await confirmWindow.setSize(new PhysicalSize(Math.round(320 * scaleFactor), Math.round(180 * scaleFactor)));
  await confirmWindow.setPosition(
    new PhysicalPosition(
      settingsPosition.x + Math.round(settingsSize.width + 12 * scaleFactor),
      settingsPosition.y + Math.round(settingsSize.height * 0.18),
    ),
  );
}

function convertBlockType(block: BlockSettings, type: BlockSettings["type"]): BlockSettings {
  if (block.type === type) {
    return block;
  }

  if (type === "placeholder") {
    return {
      ...block,
      type: "placeholder",
      periods: block.periods.slice(0, 1).map((period, order) => ({ ...period, order })),
    };
  }

  return { ...block, type: "course", periods: block.periods.map((period, order) => ({ ...period, order })) };
}
