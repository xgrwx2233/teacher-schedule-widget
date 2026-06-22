import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import { CardSettingsWindow } from "../components/CardSettingsWindow/CardSettingsWindow";
import {
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
  type CardSettingsTitleContext,
} from "../features/settings/windowEvents";

const MOVE_SUPPRESSION_MS = 300;
const FOCUS_LOSS_CHECK_MS = 120;
const OPEN_FOCUS_GUARD_MS = 500;
const LOCAL_DRAFT_SYNC_GUARD_MS = 900;
type CardSettingsTab = "course" | "temporary";

export function CardSettingsWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null);
  const [draft, setDraft] = useState<CardDraft>(defaultCardDraft);
  const [term, setTerm] = useState<TermSettings>({
    startDate: defaultCardDraft.startDate,
    endDate: defaultCardDraft.endDate,
  });
  const [mergeState, setMergeState] = useState<CourseCardMergeState>({
    canMergeUp: false,
    canMergeLeft: false,
    canMergeRight: false,
    canMergeDown: false,
    canSplit: false,
  });
  const [temporaryChanges, setTemporaryChanges] = useState<
    TemporaryChangeDraft[]
  >([]);
  const [activeTemporaryChangeId, setActiveTemporaryChangeId] = useState<
    string | null
  >(null);
  const [activeTab, setActiveTab] = useState<CardSettingsTab>("course");
  const [titleContext, setTitleContext] = useState<
    CardSettingsTitleContext | undefined
  >(undefined);
  const [temporaryDraftTitle, setTemporaryDraftTitle] = useState("");
  const isClosingRef = useRef(false);
  const openedAtRef = useRef(0);
  const hasFocusedSinceOpenRef = useRef(false);
  const lastMovedAtRef = useRef(0);
  const focusLossTimerRef = useRef<number | null>(null);
  const selectedCardRef = useRef<SelectedCard | null>(null);
  const localDraftSyncGuardUntilRef = useRef(0);
  const stateRequestTimerRef = useRef<number | null>(null);

  useEffect(() => {
    selectedCardRef.current = selectedCard;
  }, [selectedCard]);

  useEffect(() => {
    const unlistenState = listen<CardSettingsWindowStatePayload>(
      CARD_SETTINGS_WINDOW_STATE_EVENT,
      (event) => {
        if (event.payload.windowLabel !== currentWindow.label) {
          return;
        }

        if (stateRequestTimerRef.current !== null) {
          window.clearTimeout(stateRequestTimerRef.current);
          stateRequestTimerRef.current = null;
        }

        const isCurrentCard = isSameSelectedCard(
          selectedCardRef.current,
          event.payload.selectedCard,
        );
        const shouldKeepLocalDraft =
          isCurrentCard && Date.now() < localDraftSyncGuardUntilRef.current;

        openedAtRef.current = Date.now();
        hasFocusedSinceOpenRef.current = false;
        setSelectedCard(event.payload.selectedCard);
        if (!shouldKeepLocalDraft) {
          setDraft(event.payload.draft);
        }
        setMergeState(event.payload.mergeState);
        setTerm(event.payload.term);
        setTitleContext(event.payload.titleContext);
        setTemporaryChanges(event.payload.temporaryChanges ?? []);
        setActiveTemporaryChangeId(
          (currentActiveId) =>
            event.payload.activeTemporaryChangeId ??
            (isCurrentCard
              ? currentActiveId
              : (event.payload.temporaryChanges?.[0]?.id ?? null)),
        );
        if (!isCurrentCard) {
          setActiveTab("course");
          setTemporaryDraftTitle("");
        }

        window.setTimeout(() => {
          void currentWindow.setFocus();
        }, 80);
      },
    );

    stateRequestTimerRef.current = window.setTimeout(() => {
      if (selectedCardRef.current) {
        return;
      }

      void emitTo(WIDGET_WINDOW_LABEL, CARD_SETTINGS_WINDOW_STATE_REQUEST_EVENT, {
        windowLabel: currentWindow.label,
      });
    }, 120);

    return () => {
      if (stateRequestTimerRef.current !== null) {
        window.clearTimeout(stateRequestTimerRef.current);
        stateRequestTimerRef.current = null;
      }
      void unlistenState.then((unlisten) => unlisten());
    };
  }, [currentWindow.label]);

  useEffect(() => {
    if (selectedCard?.type === "period") {
      void currentWindow.setTitle("课次卡片设置");
      return;
    }

    void currentWindow.setTitle(
      buildCourseSettingsTitle(
        activeTab,
        titleContext,
        draft,
        temporaryChanges,
        activeTemporaryChangeId,
        temporaryDraftTitle,
      ),
    );
  }, [
    activeTab,
    activeTemporaryChangeId,
    currentWindow,
    draft,
    selectedCard,
    temporaryChanges,
    temporaryDraftTitle,
    titleContext,
  ]);

  const defaultTemporaryDate = useMemo(
    () => resolveTitleContextDate(titleContext, term),
    [term, titleContext],
  );

  const emitUpdate = (nextDraft: CardDraft) => {
    if (!selectedCard) {
      return;
    }

    setDraft(nextDraft);
    localDraftSyncGuardUntilRef.current =
      Date.now() + LOCAL_DRAFT_SYNC_GUARD_MS;
    void emitTo<CardSettingsWindowUpdatePayload>(
      WIDGET_WINDOW_LABEL,
      CARD_SETTINGS_WINDOW_UPDATE_EVENT,
      {
        windowLabel: currentWindow.label,
        selectedCard,
        draft: nextDraft,
      },
    );
  };

  const emitTemporaryUpdate = (
    nextTemporaryChanges: TemporaryChangeDraft[],
    nextActiveId: string | null,
  ) => {
    if (!selectedCard) {
      return;
    }

    void emitTo<CardSettingsWindowUpdatePayload>(
      WIDGET_WINDOW_LABEL,
      CARD_SETTINGS_WINDOW_UPDATE_EVENT,
      {
        windowLabel: currentWindow.label,
        selectedCard,
        draft,
        temporaryChanges: nextTemporaryChanges,
        activeTemporaryChangeId: nextActiveId,
      },
    );
  };

  const emitAction = (
    action: CardSettingsWindowActionPayload["action"],
    includeDraft = false,
  ) => {
    if (!selectedCard) {
      return;
    }

    void emitTo<CardSettingsWindowActionPayload>(
      WIDGET_WINDOW_LABEL,
      CARD_SETTINGS_WINDOW_ACTION_EVENT,
      {
        windowLabel: currentWindow.label,
        selectedCard,
        action,
        draft: includeDraft ? draft : undefined,
        temporaryChanges: includeDraft ? temporaryChanges : undefined,
        activeTemporaryChangeId: includeDraft
          ? activeTemporaryChangeId
          : undefined,
      },
    );
  };

  const updateTemporaryChange = (nextChange: TemporaryChangeDraft) => {
    setTemporaryChanges((current) => {
      const exists = current.some((change) => change.id === nextChange.id);
      const nextChanges = exists
        ? current.map((change) =>
            change.id === nextChange.id ? nextChange : change,
          )
        : [nextChange, ...current];
      const nextActiveId = nextChange.id;
      setActiveTemporaryChangeId(nextActiveId);
      emitTemporaryUpdate(nextChanges, nextActiveId);
      return nextChanges;
    });
  };

  const removeTemporaryChange = (changeId: string) => {
    setTemporaryChanges((current) => {
      const nextChanges = current.filter((change) => change.id !== changeId);
      const nextActiveId = nextChanges[0]?.id ?? null;
      setActiveTemporaryChangeId(nextActiveId);
      emitTemporaryUpdate(nextChanges, nextActiveId);
      return nextChanges;
    });
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

    const unlistenFocusPromise = currentWindow.onFocusChanged(
      async ({ payload: focused }) => {
        if (focused) {
          hasFocusedSinceOpenRef.current = true;
          clearFocusLossTimer();
          return;
        }

        clearFocusLossTimer();
        if (!hasFocusedSinceOpenRef.current) {
          return;
        }

        const elapsedSinceOpen = Date.now() - openedAtRef.current;
        const focusLossDelay = Math.max(
          FOCUS_LOSS_CHECK_MS,
          OPEN_FOCUS_GUARD_MS - elapsedSinceOpen + FOCUS_LOSS_CHECK_MS,
        );
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
        }, focusLossDelay);
      },
    );

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
        activeTab={activeTab}
        draft={draft}
        mergeState={mergeState}
        term={term}
        titleContext={titleContext}
        defaultTemporaryDate={defaultTemporaryDate}
        temporaryChanges={temporaryChanges}
        activeTemporaryChangeId={activeTemporaryChangeId}
        onActiveTabChange={setActiveTab}
        onDraftChange={emitUpdate}
        onMergeUp={() => emitAction("merge-up")}
        onMergeLeft={() => emitAction("merge-left")}
        onMergeRight={() => emitAction("merge-right")}
        onMergeDown={() => emitAction("merge-down")}
        onSplit={() => emitAction("split")}
        onDeleteCourse={() => emitAction("delete")}
        onGlobalStyleApply={() => emitAction("apply-style", true)}
        onGlobalScheduleApply={() => emitAction("apply-schedule", true)}
        onTemporaryChangeSelect={setActiveTemporaryChangeId}
        onTemporaryChangeUpdate={updateTemporaryChange}
        onTemporaryChangeRemove={removeTemporaryChange}
        onTemporaryDraftTitleChange={setTemporaryDraftTitle}
      />
    </main>
  );
}

function buildCourseSettingsTitle(
  activeTab: CardSettingsTab,
  titleContext: CardSettingsTitleContext | undefined,
  draft: CardDraft,
  temporaryChanges: TemporaryChangeDraft[],
  activeTemporaryChangeId: string | null,
  temporaryDraftTitle: string,
): string {
  const courseTitle =
    activeTab === "temporary"
      ? getTemporaryTitleForTitlebar(
          temporaryChanges,
          activeTemporaryChangeId,
          temporaryDraftTitle,
        )
      : draft.title.trim() || "未命名课程";
  const context = [
    titleContext?.weekdayLabel,
    titleContext?.periodLabel,
    courseTitle,
  ]
    .filter(Boolean)
    .join(" ");

  return activeTab === "temporary"
    ? ["课程设置", "｜", "〔临〕", context || "临时改动"].join(" ")
    : ["课程设置", "｜", context || "未命名课程"].join(" ");
}

function getTemporaryTitleForTitlebar(
  changes: TemporaryChangeDraft[],
  activeChangeId: string | null,
  draftTitle: string,
): string {
  const activeChange = changes.find((change) => change.id === activeChangeId);
  if (activeChange) {
    return getTemporaryChangeTitle(activeChange);
  }

  const effectiveChange = changes.find(isEffectiveTemporaryChange);
  if (effectiveChange) {
    return getTemporaryChangeTitle(effectiveChange);
  }

  return draftTitle.trim() || "临时改动";
}

function getTemporaryChangeTitle(change: TemporaryChangeDraft): string {
  return (change.title || change.replaceTitle || "").trim() || "临时改动";
}

function isEffectiveTemporaryChange(change: TemporaryChangeDraft): boolean {
  const today = formatLocalIsoDate(new Date());
  return change.dates.some((date) => date >= today);
}

function formatLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function resolveTitleContextDate(
  titleContext: CardSettingsTitleContext | undefined,
  term: TermSettings,
): string | undefined {
  if (titleContext?.date) {
    return titleContext.date;
  }

  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(titleContext?.dateLabel ?? "");
  if (!match) {
    return undefined;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day)) {
    return undefined;
  }

  const startYear = Number(term.startDate.slice(0, 4));
  const endYear = Number(term.endDate.slice(0, 4));
  const startMonth = Number(term.startDate.slice(5, 7));
  const year =
    endYear !== startYear && month < startMonth ? endYear : startYear;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isSameSelectedCard(
  left: SelectedCard | null,
  right: SelectedCard | null,
): boolean {
  if (!left || !right || left.type !== right.type) {
    return false;
  }

  return left.type === "course"
    ? right.type === "course" && left.courseId === right.courseId
    : right.type === "period" && left.periodId === right.periodId;
}
