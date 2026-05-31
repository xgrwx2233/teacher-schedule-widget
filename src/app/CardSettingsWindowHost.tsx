import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState } from "react";
import { CardSettingsWindow } from "../components/CardSettingsWindow/CardSettingsWindow";
import {
  createDefaultTemporaryChangeDraft,
  defaultCardDraft,
  type CardDraft,
  type CourseCardMergeState,
  type SelectedCard,
  type TemporaryChangeDraft,
} from "../features/settings/settingsTypes";
import {
  CARD_SETTINGS_WINDOW_ACTION_EVENT,
  CARD_SETTINGS_WINDOW_CLOSE_EVENT,
  CARD_SETTINGS_WINDOW_STATE_EVENT,
  CARD_SETTINGS_WINDOW_STATE_REQUEST_EVENT,
  CARD_SETTINGS_WINDOW_UPDATE_EVENT,
  WIDGET_WINDOW_LABEL,
  type CardSettingsWindowActionPayload,
  type CardSettingsWindowStatePayload,
  type CardSettingsWindowUpdatePayload,
} from "../features/settings/windowEvents";

export function CardSettingsWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null);
  const [draft, setDraft] = useState<CardDraft>(defaultCardDraft);
  const [mergeState, setMergeState] = useState<CourseCardMergeState>({ canMergeRight: false, canSplit: false });
  const [temporaryChanges, setTemporaryChanges] = useState<TemporaryChangeDraft[]>(() => [
    createDefaultTemporaryChangeDraft(new Date().toISOString().slice(0, 10)),
  ]);
  const [activeTemporaryChangeId, setActiveTemporaryChangeId] = useState<string | null>(null);

  useEffect(() => {
    const unlistenState = listen<CardSettingsWindowStatePayload>(CARD_SETTINGS_WINDOW_STATE_EVENT, (event) => {
      setSelectedCard(event.payload.selectedCard);
      setDraft(event.payload.draft);
      setMergeState(event.payload.mergeState);
      setTemporaryChanges(event.payload.temporaryChanges ?? []);
      setActiveTemporaryChangeId(event.payload.activeTemporaryChangeId ?? event.payload.temporaryChanges?.[0]?.id ?? null);
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
      temporaryChanges,
      activeTemporaryChangeId,
    });
  };

  const emitTemporaryUpdate = (nextTemporaryChanges: TemporaryChangeDraft[], nextActiveId: string | null) => {
    if (!selectedCard) {
      return;
    }

    void emitTo<CardSettingsWindowUpdatePayload>(WIDGET_WINDOW_LABEL, CARD_SETTINGS_WINDOW_UPDATE_EVENT, {
      windowLabel: currentWindow.label,
      selectedCard,
      draft,
      temporaryChanges: nextTemporaryChanges,
      activeTemporaryChangeId: nextActiveId,
    });
  };

  const emitAction = (action: CardSettingsWindowActionPayload["action"]) => {
    if (!selectedCard) {
      return;
    }

    void emitTo<CardSettingsWindowActionPayload>(WIDGET_WINDOW_LABEL, CARD_SETTINGS_WINDOW_ACTION_EVENT, {
      windowLabel: currentWindow.label,
      selectedCard,
      action,
    });
  };

  const addTemporaryChange = () => {
    const nextChange = createDefaultTemporaryChangeDraft(new Date().toISOString().slice(0, 10));
    const nextChanges = [nextChange, ...temporaryChanges];
    setTemporaryChanges(nextChanges);
    setActiveTemporaryChangeId(nextChange.id);
    emitTemporaryUpdate(nextChanges, nextChange.id);
  };

  const updateTemporaryChange = (nextChange: TemporaryChangeDraft) => {
    const nextChanges = temporaryChanges.map((change) => (change.id === nextChange.id ? nextChange : change));
    setTemporaryChanges(nextChanges);
    emitTemporaryUpdate(nextChanges, activeTemporaryChangeId);
  };

  const removeTemporaryChange = (changeId: string) => {
    const nextChanges = temporaryChanges.filter((change) => change.id !== changeId);
    const nextActiveId = nextChanges[0]?.id ?? null;
    setTemporaryChanges(nextChanges);
    setActiveTemporaryChangeId(nextActiveId);
    emitTemporaryUpdate(nextChanges, nextActiveId);
  };

  const closeWindow = async () => {
    await invoke("set_proxy_passthrough", { passthrough: true });
    await invoke("clear_proxy_active_card");
    await emitTo(WIDGET_WINDOW_LABEL, CARD_SETTINGS_WINDOW_CLOSE_EVENT, {
      windowLabel: currentWindow.label,
    });
    await currentWindow.hide();
  };

  useEffect(() => {
    const unlistenPromise = currentWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await closeWindow();
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [currentWindow, selectedCard, draft]);

  return (
    <main className="dialog-window-root">
      <CardSettingsWindow
        selectedCard={selectedCard}
        draft={draft}
        mergeState={mergeState}
        temporaryChanges={temporaryChanges}
        activeTemporaryChangeId={activeTemporaryChangeId}
        onDraftChange={emitUpdate}
        onMergeRight={() => emitAction("merge-right")}
        onSplit={() => emitAction("split")}
        onClose={closeWindow}
        onTemporaryChangeAdd={addTemporaryChange}
        onTemporaryChangeSelect={setActiveTemporaryChangeId}
        onTemporaryChangeUpdate={updateTemporaryChange}
        onTemporaryChangeRemove={removeTemporaryChange}
      />
    </main>
  );
}
