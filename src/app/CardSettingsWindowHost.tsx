import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PointerEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { CardSettingsWindow } from "../components/CardSettingsWindow/CardSettingsWindow";
import { defaultCardDraft, type CardDraft, type SelectedCard } from "../features/settings/settingsTypes";
import {
  CARD_SETTINGS_WINDOW_CLOSE_EVENT,
  CARD_SETTINGS_WINDOW_STATE_EVENT,
  CARD_SETTINGS_WINDOW_STATE_REQUEST_EVENT,
  CARD_SETTINGS_WINDOW_UPDATE_EVENT,
  WIDGET_WINDOW_LABEL,
  type CardSettingsWindowStatePayload,
  type CardSettingsWindowUpdatePayload,
} from "../features/settings/windowEvents";

export function CardSettingsWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null);
  const [draft, setDraft] = useState<CardDraft>(defaultCardDraft);

  useEffect(() => {
    const unlistenState = listen<CardSettingsWindowStatePayload>(CARD_SETTINGS_WINDOW_STATE_EVENT, (event) => {
      setSelectedCard(event.payload.selectedCard);
      setDraft(event.payload.draft);
    });

    void emitTo(WIDGET_WINDOW_LABEL, CARD_SETTINGS_WINDOW_STATE_REQUEST_EVENT, {
      windowLabel: currentWindow.label,
    });

    return () => {
      void unlistenState.then((unlisten) => unlisten());
    };
  }, [currentWindow.label]);

  const emitUpdate = (nextDraft: CardDraft) => {
    if (!selectedCard) {
      return;
    }

    setDraft(nextDraft);
    void emitTo<CardSettingsWindowUpdatePayload>(WIDGET_WINDOW_LABEL, CARD_SETTINGS_WINDOW_UPDATE_EVENT, {
      windowLabel: currentWindow.label,
      selectedCard,
      draft: nextDraft,
    });
  };

  const startDrag = async (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    await currentWindow.startDragging();
  };

  const closeWindow = async () => {
    await invoke("set_proxy_passthrough", { passthrough: true });
    await invoke("clear_proxy_active_card");
    await emitTo(WIDGET_WINDOW_LABEL, CARD_SETTINGS_WINDOW_CLOSE_EVENT, {
      windowLabel: currentWindow.label,
    });
    await currentWindow.hide();
  };

  return (
    <main className="dialog-window-root">
      <CardSettingsWindow
        selectedCard={selectedCard}
        draft={draft}
        onDraftChange={emitUpdate}
        onDragStart={startDrag}
        onClose={closeWindow}
      />
    </main>
  );
}
