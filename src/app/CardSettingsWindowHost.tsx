import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import { CardSettingsWindow } from "../components/CardSettingsWindow/CardSettingsWindow";
import {
  createDefaultTemporaryChangeDraft,
  defaultCardDraft,
  type CardDraft,
  type CourseCardMergeState,
  type SelectedCard,
  type TermSettings,
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

const MOVE_SUPPRESSION_MS = 300;
const FOCUS_LOSS_CHECK_MS = 120;

export function CardSettingsWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null);
  const [draft, setDraft] = useState<CardDraft>(defaultCardDraft);
  const [term, setTerm] = useState<TermSettings>({ startDate: defaultCardDraft.startDate, endDate: defaultCardDraft.endDate });
  const [mergeState, setMergeState] = useState<CourseCardMergeState>({ canMergeRight: false, canSplit: false });
  const [temporaryChanges, setTemporaryChanges] = useState<TemporaryChangeDraft[]>(() => [
    createDefaultTemporaryChangeDraft(new Date().toISOString().slice(0, 10)),
  ]);
  const [activeTemporaryChangeId, setActiveTemporaryChangeId] = useState<string | null>(null);
  const isClosingRef = useRef(false);
  const lastMovedAtRef = useRef(0);
  const focusLossTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const unlistenState = listen<CardSettingsWindowStatePayload>(CARD_SETTINGS_WINDOW_STATE_EVENT, (event) => {
      setSelectedCard(event.payload.selectedCard);
      setDraft(event.payload.draft);
      setMergeState(event.payload.mergeState);
      setTerm(event.payload.term);
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

  const emitAction = (action: CardSettingsWindowActionPayload["action"], includeDraft = false) => {
    if (!selectedCard) {
      return;
    }

    void emitTo<CardSettingsWindowActionPayload>(WIDGET_WINDOW_LABEL, CARD_SETTINGS_WINDOW_ACTION_EVENT, {
      windowLabel: currentWindow.label,
      selectedCard,
      action,
      draft: includeDraft ? draft : undefined,
      temporaryChanges: includeDraft ? temporaryChanges : undefined,
      activeTemporaryChangeId: includeDraft ? activeTemporaryChangeId : undefined,
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
    if (isClosingRef.current) {
      return;
    }

    try {
      isClosingRef.current = true;
      await invoke("set_proxy_passthrough", { passthrough: true });
      await invoke("clear_proxy_active_card");
      await emitTo(WIDGET_WINDOW_LABEL, CARD_SETTINGS_WINDOW_CLOSE_EVENT, {
        windowLabel: currentWindow.label,
      });
      await currentWindow.hide();
    } finally {
      isClosingRef.current = false;
    }
  };

  useEffect(() => {
    const clearFocusLossTimer = () => {
      if (focusLossTimerRef.current === null) {
        return;
      }

      window.clearTimeout(focusLossTimerRef.current);
      focusLossTimerRef.current = null;
    };

    const unlistenPromise = currentWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      clearFocusLossTimer();
      await closeWindow();
    });

    const unlistenMovePromise = currentWindow.onMoved(() => {
      lastMovedAtRef.current = Date.now();
      clearFocusLossTimer();
    });

    const unlistenFocusPromise = currentWindow.onFocusChanged(async ({ payload: focused }) => {
      if (focused) {
        clearFocusLossTimer();
        return;
      }

      clearFocusLossTimer();
      focusLossTimerRef.current = window.setTimeout(() => {
        focusLossTimerRef.current = null;
        void (async () => {
          if (Date.now() - lastMovedAtRef.current < MOVE_SUPPRESSION_MS) {
            return;
          }

          if (await currentWindow.isFocused()) {
            return;
          }

          await closeWindow();
        })();
      }, FOCUS_LOSS_CHECK_MS);
    });

    return () => {
      clearFocusLossTimer();
      void unlistenPromise.then((unlisten) => unlisten());
      void unlistenMovePromise.then((unlisten) => unlisten());
      void unlistenFocusPromise.then((unlisten) => unlisten());
    };
  }, [currentWindow]);

  return (
    <main className="dialog-window-root">
      <CardSettingsWindow
        selectedCard={selectedCard}
        draft={draft}
        mergeState={mergeState}
        term={term}
        temporaryChanges={temporaryChanges}
        activeTemporaryChangeId={activeTemporaryChangeId}
        onDraftChange={emitUpdate}
        onMergeRight={() => emitAction("merge-right")}
        onSplit={() => emitAction("split")}
        onDeleteCourse={() => emitAction("delete")}
        onAddCourse={() => emitAction("add", true)}
        onGlobalStyleApply={() => emitAction("apply-style", true)}
        onGlobalScheduleApply={() => emitAction("apply-schedule", true)}
        onTemporaryChangeAdd={addTemporaryChange}
        onTemporaryChangeSelect={setActiveTemporaryChangeId}
        onTemporaryChangeUpdate={updateTemporaryChange}
        onTemporaryChangeRemove={removeTemporaryChange}
      />
    </main>
  );
}
