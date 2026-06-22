import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { CSSProperties } from "react";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AuxWindowTitleBar } from "./AuxWindowTitleBar";
import {
  cacheChatFile,
  deleteChatMessageForMe,
  downloadChatFile,
  listenForDeletedChatMessages,
  listenForNewChatMessages,
  listenForRevokedChatMessages,
  loadChatConversations,
  loadChatHistoryMessages,
  openCachedChatFile,
} from "../features/chat/chatRepository";
import { forwardChatMessage } from "../features/chat/chatForwarding";
import {
  chatAccountKeyFromState,
  loadCachedConversationHistoryState,
  loadCachedConversationMessages,
  mergeCachedConversationMessages,
  removeCachedConversationMessage,
  saveCachedConversationHistoryState,
} from "../features/chat/chatLocalCache";
import {
  contentTypeFromMessage,
  fileNameFromMessage,
  fileObjectIdFromMessage,
  fileUrlFromMessage,
  formatBytes,
  imagePreviewItemFromMessage,
  messagePreview,
  sizeBytesFromMessage,
} from "../features/chat/chatMessageUtils";
import type { LocalAccountState } from "../features/account/types";
import type { ChatConversation, ChatMessage, ImagePreviewItem } from "../features/chat/types";
import {
  AUTH_STATE_CHANGED_EVENT,
  CHAT_LOCATE_MESSAGE_EVENT,
  CHAT_HISTORY_OPEN_EVENT,
  CHAT_QUOTE_MESSAGE_EVENT,
} from "../features/settings/windowEvents";
import FolderClosedIcon from "../../images/folder-closed.svg";
import SearchIcon from "../../images/search.svg";

type ChatHistoryOpenPayload = {
  conversationId: string;
  conversationTitle: string;
  currentUserId?: number | null;
  peerUserId?: number | null;
};

type HistoryFilter = "all" | "file" | "media";
type HistoryContextMenu = {
  messageId: string;
  x: number;
  y: number;
} | null;
type HistoryForwardState = {
  message: ChatMessage;
} | null;

type FilterOption = {
  id: Exclude<HistoryFilter, "all"> | "link" | "music" | "miniapp" | "channel" | "date";
  label: string;
  enabled: boolean;
};

const HISTORY_PAGE_SIZE = 80;
const FILTER_OPTIONS: FilterOption[] = [
  { id: "file", label: "文件", enabled: true },
  { id: "media", label: "图片与视频", enabled: true },
  { id: "link", label: "链接", enabled: false },
  { id: "music", label: "音乐", enabled: false },
  { id: "miniapp", label: "小程序", enabled: false },
  { id: "channel", label: "视频号", enabled: false },
  { id: "date", label: "日期", enabled: false },
];

const historyIconStyle = {
  "--chat-history-icon-url": `url("${FolderClosedIcon}")`,
} as CSSProperties;

const searchIconStyle = {
  "--chat-history-icon-url": `url("${SearchIcon}")`,
} as CSSProperties;

const thumbnailCachePromises = new Map<string, Promise<string>>();

export function ChatHistoryWindowHost() {
  const [context, setContext] = useState<ChatHistoryOpenPayload | null>(null);
  const [accountKey, setAccountKey] = useState<string | null>(null);
  const [accountResolved, setAccountResolved] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [serverSearching, setServerSearching] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<HistoryContextMenu>(null);
  const [forwardState, setForwardState] = useState<HistoryForwardState>(null);
  const [forwardConversations, setForwardConversations] = useState<ChatConversation[]>([]);
  const [forwardLoading, setForwardLoading] = useState(false);
  const [forwardError, setForwardError] = useState<string | null>(null);
  const [forwardSendingId, setForwardSendingId] = useState<string | null>(null);
  const openSeqRef = useRef(0);
  const contextRef = useRef<ChatHistoryOpenPayload | null>(null);
  const accountKeyRef = useRef<string | null>(null);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  useEffect(() => {
    accountKeyRef.current = accountKey;
  }, [accountKey]);

  useEffect(() => {
    let disposed = false;
    let unlistenAuth: (() => void) | null = null;
    let unlisten: (() => void) | null = null;
    async function resolveAccountKey() {
      try {
        const state = await invoke<LocalAccountState>("load_local_account_state");
        return chatAccountKeyFromState(state);
      } catch {
        return null;
      }
    }
    async function bind() {
      unlisten = await listen<ChatHistoryOpenPayload>(
        CHAT_HISTORY_OPEN_EVENT,
        (event) => {
          if (disposed) {
            return;
          }
          const payload = event.payload;
          const openSeq = openSeqRef.current + 1;
          openSeqRef.current = openSeq;
          setContext(payload);
          setAccountResolved(false);
          setFilter("all");
          setQuery("");
          setError(null);
          setContextMenu(null);
          setForwardState(null);
          setExhausted(false);
          setLoading(true);
          void resolveAccountKey().then((nextAccountKey) => {
            if (disposed || openSeqRef.current !== openSeq) {
              return;
            }
            setAccountKey(nextAccountKey);
            const cachedMessages = loadCachedConversationMessages(
              nextAccountKey,
              payload.conversationId,
            );
            const historyState = loadCachedConversationHistoryState(
              nextAccountKey,
              payload.conversationId,
            );
            setMessages(cachedMessages);
            setExhausted(Boolean(historyState?.exhausted));
            setAccountResolved(true);
          });
        },
      );
      unlistenAuth = await listen<LocalAccountState>(
        AUTH_STATE_CHANGED_EVENT,
        (event) => {
          if (disposed) {
            return;
          }
          openSeqRef.current += 1;
          const nextAccountKey = chatAccountKeyFromState(event.payload);
          setAccountKey(nextAccountKey);
          setAccountResolved(false);
          setContext(null);
          setMessages([]);
          setFilter("all");
          setQuery("");
          setLoading(false);
          setLoadingOlder(false);
          setExhausted(false);
          setError(null);
          setContextMenu(null);
          setForwardState(null);
        },
      );
    }
    void bind();
    return () => {
      disposed = true;
      unlisten?.();
      unlistenAuth?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenDeletedMessages: (() => void) | null = null;
    let unlistenNewMessages: (() => void) | null = null;
    let unlistenRevokedMessages: (() => void) | null = null;
    async function bindRealtimeEvents() {
      unlistenNewMessages = await listenForNewChatMessages((message) => {
        const currentContext = contextRef.current;
        if (
          disposed ||
          !currentContext ||
          message.conversationId !== currentContext.conversationId
        ) {
          return;
        }
        setMessages((current) => {
          const mergedMessages = mergeHistoryMessages(current, [message]);
          mergeCachedConversationMessages(
            accountKeyRef.current,
            currentContext.conversationId,
            [message],
          );
          return mergedMessages;
        });
      });
      unlistenRevokedMessages = await listenForRevokedChatMessages((message) => {
        const currentContext = contextRef.current;
        if (
          disposed ||
          !currentContext ||
          message.conversationId !== currentContext.conversationId
        ) {
          return;
        }
        setMessages((current) => {
          const mergedMessages = mergeHistoryMessages(current, [message]);
          mergeCachedConversationMessages(
            accountKeyRef.current,
            currentContext.conversationId,
            [message],
          );
          return mergedMessages;
        });
      });
      unlistenDeletedMessages = await listenForDeletedChatMessages((event) => {
        const currentContext = contextRef.current;
        if (
          disposed ||
          !currentContext ||
          event.conversationId !== currentContext.conversationId
        ) {
          return;
        }
        setMessages((current) =>
          current.filter((message) => message.id !== event.messageId),
        );
        removeCachedConversationMessage(
          accountKeyRef.current,
          currentContext.conversationId,
          event.messageId,
        );
      });
    }
    void bindRealtimeEvents();
    return () => {
      disposed = true;
      unlistenNewMessages?.();
      unlistenRevokedMessages?.();
      unlistenDeletedMessages?.();
    };
  }, []);

  useEffect(() => {
    if (!context?.conversationId || !accountResolved) {
      return;
    }
    if (!accountKey) {
      setLoading(false);
      setError("请先登录后查看聊天记录");
      return;
    }
    const conversationId = context.conversationId;
    const currentAccountKey = accountKey;
    let cancelled = false;
    async function loadInitialMessages() {
      setLoading(true);
      setError(null);
      try {
        const nextMessages = await loadChatHistoryMessages(conversationId, {
          type: "all",
          limit: HISTORY_PAGE_SIZE,
        });
        if (!cancelled) {
          const remoteExhausted = nextMessages.length < HISTORY_PAGE_SIZE;
          const mergedMessages = mergeCachedConversationMessages(
            currentAccountKey,
            conversationId,
            nextMessages,
            { exhausted: remoteExhausted ? true : null },
          );
          setMessages(
            mergedMessages.length > 0 ? mergedMessages : sortMessages(nextMessages),
          );
          const historyState = loadCachedConversationHistoryState(
            currentAccountKey,
            conversationId,
          );
          setExhausted(Boolean(historyState?.exhausted || remoteExhausted));
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(String(nextError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadInitialMessages();
    return () => {
      cancelled = true;
    };
  }, [accountKey, accountResolved, context?.conversationId]);

  useEffect(() => {
    if (!context?.conversationId || !accountResolved || !accountKey) {
      return;
    }
    if (filter === "all" && query.trim() === "") {
      setServerSearching(false);
      return;
    }
    const conversationId = context.conversationId;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setServerSearching(true);
      setError(null);
      void loadChatHistoryMessages(conversationId, {
        type: filter === "media" ? "media" : filter,
        query,
        limit: HISTORY_PAGE_SIZE,
      })
        .then((nextMessages) => {
          if (cancelled) {
            return;
          }
          setMessages(sortMessages(nextMessages));
        })
        .catch((nextError) => {
          if (!cancelled) {
            setError(String(nextError));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setServerSearching(false);
          }
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [accountKey, accountResolved, context?.conversationId, filter, query]);

  const title = context?.conversationTitle || "";
  const serverHistoryMode = filter !== "all" || query.trim() !== "";
  const activeMenuMessage = contextMenu
    ? messages.find((message) => message.id === contextMenu.messageId)
    : undefined;
  const activeFilterLabel =
    filter === "file" ? "文件" : filter === "media" ? "图片与视频" : "";
  const filteredMessages = useMemo(
    () =>
      serverHistoryMode
        ? sortMessages(messages)
        : applyHistoryFilter(messages, filter, query),
    [messages, filter, query, serverHistoryMode],
  );
  const mediaMessages = useMemo(
    () =>
      messages
        .filter(isMediaMessage)
        .map(imagePreviewItemFromMessage)
        .filter(Boolean) as ImagePreviewItem[],
    [messages],
  );

  const closeFloatingUi = () => {
    setContextMenu(null);
  };

  const openHistoryContextMenu = (
    event: MouseEvent<HTMLElement>,
    message: ChatMessage,
  ) => {
    if (message.status === "revoked" || message.kind === "system") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      messageId: message.id,
      x: Math.min(event.clientX, window.innerWidth - 160),
      y: Math.min(event.clientY, window.innerHeight - 210),
    });
  };

  const loadOlder = async () => {
    if (!context?.conversationId || loadingOlder || exhausted) {
      return;
    }
    const beforeSeq = Math.min(
      ...messages
        .map((message) => message.conversationSeq ?? Number.POSITIVE_INFINITY)
        .filter(Number.isFinite),
    );
    if (!Number.isFinite(beforeSeq) || beforeSeq <= 1) {
      setExhausted(true);
      return;
    }

    const isServerMode = filter !== "all" || query.trim() !== "";
    setLoadingOlder(true);
    setError(null);
    try {
      const olderMessages = await loadChatHistoryMessages(context.conversationId, {
        type: isServerMode ? (filter === "media" ? "media" : filter) : "all",
        query: isServerMode ? query : "",
        beforeSeq,
        limit: HISTORY_PAGE_SIZE,
      });
      const olderExhausted = olderMessages.length < HISTORY_PAGE_SIZE;
      setMessages((current) => {
        const mergedMessages = mergeHistoryMessages(current, olderMessages);
        if (!isServerMode) {
          mergeCachedConversationMessages(
            accountKey,
            context.conversationId,
            olderMessages,
            { exhausted: olderExhausted ? true : null },
          );
        }
        return mergedMessages;
      });
      if (olderExhausted && !isServerMode) {
        saveCachedConversationHistoryState(accountKey, context.conversationId, {
          exhausted: true,
        });
      }
      setExhausted(olderExhausted);
    } catch (nextError) {
      setError(String(nextError));
    } finally {
      setLoadingOlder(false);
    }
  };

  const openImagePreview = (message: ChatMessage) => {
    const activeItem = imagePreviewItemFromMessage(message);
    const images = mediaMessages.length > 0 ? mediaMessages : activeItem ? [activeItem] : [];
    if (!activeItem || images.length === 0) {
      return;
    }
    void invoke("open_image_preview_window", {
      payload: {
        images,
        activeId: activeItem.id,
      },
    });
  };

  const downloadFile = async (message: ChatMessage) => {
    const fileObjectId = fileObjectIdFromMessage(message);
    if (!fileObjectId) {
      setError("当前记录缺少云端文件信息，暂不能下载");
      return;
    }
    try {
      const result = await downloadChatFile(
        fileObjectId,
        fileNameFromMessage(message, "文件"),
      );
      if (!result.cancelled && result.path) {
        setError(`已下载到 ${result.path}`);
      }
    } catch (nextError) {
      setError(String(nextError));
    }
  };

  const openFile = async (message: ChatMessage) => {
    const fileObjectId = fileObjectIdFromMessage(message);
    if (!fileObjectId) {
      setError("当前记录缺少云端文件信息，暂不能打开");
      return;
    }
    try {
      await openCachedChatFile(fileObjectId, fileNameFromMessage(message, "文件"));
    } catch (nextError) {
      setError(String(nextError));
    }
  };

  const removeMessageLocally = async (message: ChatMessage) => {
    if (!context?.conversationId) {
      return;
    }
    setContextMenu(null);
    try {
      await deleteChatMessageForMe(message.id);
      setMessages((current) => current.filter((item) => item.id !== message.id));
      removeCachedConversationMessage(accountKey, context.conversationId, message.id);
    } catch (nextError) {
      setError(String(nextError));
    }
  };

  const openForwardPicker = async (message: ChatMessage) => {
    setContextMenu(null);
    setForwardState({ message });
    setForwardLoading(true);
    setForwardError(null);
    try {
      setForwardConversations(await loadChatConversations());
    } catch (nextError) {
      setForwardError(String(nextError));
    } finally {
      setForwardLoading(false);
    }
  };

  const forwardToConversation = async (targetConversation: ChatConversation) => {
    const source = forwardState?.message;
    if (!source || forwardSendingId) {
      return;
    }
    setForwardSendingId(targetConversation.id);
    setForwardError(null);
    try {
      await forwardChatMessage(source, targetConversation.id);
      setForwardState(null);
    } catch (nextError) {
      setForwardError(String(nextError));
    } finally {
      setForwardSendingId(null);
    }
  };

  const quoteMessageToChat = async (message: ChatMessage) => {
    if (!context?.conversationId) {
      return;
    }
    setContextMenu(null);
    await invoke("open_chat_window").catch(() => undefined);
    await emit(CHAT_QUOTE_MESSAGE_EVENT, {
      conversationId: context.conversationId,
      messageId: message.id,
      senderLabel: senderLabel(message),
      preview: messagePreview(message),
    });
  };

  const locateMessageInChat = async (message: ChatMessage) => {
    if (!context?.conversationId) {
      return;
    }
    setContextMenu(null);
    await invoke("open_chat_window").catch(() => undefined);
    await emit(CHAT_LOCATE_MESSAGE_EVENT, {
      conversationId: context.conversationId,
      messageId: message.id,
      conversationSeq: message.conversationSeq ?? null,
    });
  };

  const handleContextAction = (
    action: "forward" | "quote" | "delete" | "download" | "open" | "locate",
    message: ChatMessage,
  ) => {
    if (action === "forward") {
      void openForwardPicker(message);
      return;
    }
    if (action === "quote") {
      void quoteMessageToChat(message);
      return;
    }
    if (action === "delete") {
      void removeMessageLocally(message);
      return;
    }
    if (action === "download") {
      setContextMenu(null);
      void downloadFile(message);
      return;
    }
    if (action === "open") {
      setContextMenu(null);
      void openFile(message);
      return;
    }
    if (action === "locate") {
      void locateMessageInChat(message);
    }
  };

  return (
    <main className="chat-history-window" onClick={closeFloatingUi}>
      <AuxWindowTitleBar
        title={title ? `与“${title}”的聊天记录` : "聊天记录"}
        maximize={false}
        closeMode="hide"
      />
      <section className="chat-history-search-section">
        <label className="chat-history-search">
          <span
            className="chat-history-icon"
            style={searchIconStyle}
            aria-hidden="true"
          />
          {activeFilterLabel ? (
            <button
              type="button"
              className="chat-history-filter-chip"
              onClick={() => setFilter("all")}
              title="清除筛选"
            >
              {activeFilterLabel}
              <span>×</span>
            </button>
          ) : null}
          <input
            value={query}
            placeholder="搜索"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>

        <nav className="chat-history-filters" aria-label="聊天记录筛选">
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={[
                filter === option.id ? "is-active" : "",
                !option.enabled ? "is-disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={!option.enabled}
              title={option.enabled ? option.label : `${option.label}稍后接入`}
              onClick={() => {
                if (option.enabled) {
                  setFilter(option.id as HistoryFilter);
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </nav>
      </section>

      <section className="chat-history-content">
        {!context ? (
          <HistoryEmptyState title="打开一个会话后查看聊天记录" />
        ) : loading && messages.length === 0 ? (
          <HistoryEmptyState title="正在加载聊天记录..." />
        ) : error && messages.length === 0 ? (
          <HistoryEmptyState title="聊天记录加载失败" description={error} />
        ) : filteredMessages.length === 0 ? (
          <HistoryEmptyState
            title={emptyTitle(filter, query)}
            description={emptyDescription(filter, query)}
          />
        ) : filter === "file" ? (
          <HistoryFileList
            messages={filteredMessages}
            onDownload={downloadFile}
            onOpenFile={openFile}
            onOpenContextMenu={openHistoryContextMenu}
          />
        ) : filter === "media" ? (
          <HistoryMediaGrid
            messages={filteredMessages}
            onOpenPreview={openImagePreview}
            onDownload={downloadFile}
            onOpenContextMenu={openHistoryContextMenu}
          />
        ) : (
          <HistoryTimeline
            messages={filteredMessages}
            onOpenPreview={openImagePreview}
            onDownload={downloadFile}
            onOpenFile={openFile}
            onOpenContextMenu={openHistoryContextMenu}
          />
        )}
      </section>

      <footer className="chat-history-footer">
        <span>{footerText(messages, filteredMessages, filter, query)}</span>
        {(loading || serverSearching) && messages.length > 0 ? (
          <em>正在同步云端记录...</em>
        ) : error && messages.length > 0 ? (
          <em>{error}</em>
        ) : null}
        {context && !loading && !exhausted ? (
          <button
            type="button"
            disabled={loadingOlder}
            onClick={() => void loadOlder()}
          >
            {loadingOlder ? "正在加载..." : "加载更早记录"}
          </button>
        ) : null}
      </footer>
      {contextMenu && activeMenuMessage ? (
        <HistoryContextMenuView
          menu={contextMenu}
          message={activeMenuMessage}
          onAction={handleContextAction}
        />
      ) : null}
      {forwardState ? (
        <HistoryForwardPicker
          conversations={forwardConversations}
          loading={forwardLoading}
          error={forwardError}
          sendingId={forwardSendingId}
          source={forwardState.message}
          onClose={() => {
            if (!forwardSendingId) {
              setForwardState(null);
            }
          }}
          onSelect={(conversation) => void forwardToConversation(conversation)}
        />
      ) : null}
    </main>
  );
}

function HistoryTimeline({
  messages,
  onOpenPreview,
  onDownload,
  onOpenFile,
  onOpenContextMenu,
}: {
  messages: ChatMessage[];
  onOpenPreview: (message: ChatMessage) => void;
  onDownload: (message: ChatMessage) => void;
  onOpenFile: (message: ChatMessage) => void;
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void;
}) {
  const groups = groupMessagesByDate(messages);
  return (
    <div className="chat-history-timeline">
      {groups.map((group) => (
        <section key={group.key} className="chat-history-date-group">
          <h2>{group.label}</h2>
          {group.messages.map((message) => (
            <article
              key={message.id}
              className="chat-history-record"
              onContextMenu={(event) => onOpenContextMenu(event, message)}
            >
              <div className="chat-history-record-meta">
                <strong>{senderLabel(message)}</strong>
                <span>{message.timeLabel || " "}</span>
              </div>
              {message.kind === "image" ? (
                <HistoryImageThumb
                  message={message}
                  onOpenPreview={onOpenPreview}
                  onOpenContextMenu={onOpenContextMenu}
                />
              ) : message.kind === "file" ? (
                <HistoryFileRow
                  message={message}
                  compact
                  onDownload={onDownload}
                  onOpenFile={onOpenFile}
                  onOpenContextMenu={onOpenContextMenu}
                />
              ) : message.kind === "sticker" ? (
                <HistoryStickerRecord message={message} />
              ) : (
                <p className={`chat-history-text kind-${message.kind}`}>
                  {messagePreview(message)}
                </p>
              )}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

function HistoryFileList({
  messages,
  onDownload,
  onOpenFile,
  onOpenContextMenu,
}: {
  messages: ChatMessage[];
  onDownload: (message: ChatMessage) => void;
  onOpenFile: (message: ChatMessage) => void;
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void;
}) {
  return (
    <div className="chat-history-file-list">
      {messages.map((message) => (
        <HistoryFileRow
          key={message.id}
          message={message}
          onDownload={onDownload}
          onOpenFile={onOpenFile}
          onOpenContextMenu={onOpenContextMenu}
        />
      ))}
    </div>
  );
}

function HistoryFileRow({
  message,
  compact = false,
  onDownload,
  onOpenFile,
  onOpenContextMenu,
}: {
  message: ChatMessage;
  compact?: boolean;
  onDownload: (message: ChatMessage) => void;
  onOpenFile?: (message: ChatMessage) => void;
  onOpenContextMenu?: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void;
}) {
  const size = sizeBytesFromMessage(message);
  const fileType = fileTypeLabel(message);
  return (
    <article
      className={`chat-history-file-row ${compact ? "is-compact" : ""}`}
      onDoubleClick={() => onOpenFile?.(message)}
      onContextMenu={(event) => onOpenContextMenu?.(event, message)}
    >
      <div
        className={`chat-history-file-icon type-${fileTypeClass(message)}`}
        style={historyIconStyle}
      />
      <div className="chat-history-file-main">
        <strong>{fileNameFromMessage(message, "文件")}</strong>
        <span>
          {senderLabel(message)}
          {fileType ? ` 路 ${fileType}` : ""}
        </span>
      </div>
      <div className="chat-history-file-side">
        <span>{message.timeLabel}</span>
        <em>{size > 0 ? formatBytes(size) : fileType}</em>
      </div>
      <button type="button" onClick={() => onDownload(message)}>
        下载
      </button>
    </article>
  );
}

function HistoryMediaGrid({
  messages,
  onOpenPreview,
  onDownload,
  onOpenContextMenu,
}: {
  messages: ChatMessage[];
  onOpenPreview: (message: ChatMessage) => void;
  onDownload: (message: ChatMessage) => void;
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void;
}) {
  return (
    <div className="chat-history-media-grid">
      {messages.map((message) =>
        message.kind === "image" ? (
          <HistoryImageThumb
            key={message.id}
            message={message}
            onOpenPreview={onOpenPreview}
            onOpenContextMenu={onOpenContextMenu}
            showMeta
          />
        ) : (
          <HistoryVideoThumb
            key={message.id}
            message={message}
            onDownload={onDownload}
            onOpenContextMenu={onOpenContextMenu}
          />
        ),
      )}
    </div>
  );
}

function HistoryVideoThumb({
  message,
  onDownload,
  onOpenContextMenu,
}: {
  message: ChatMessage;
  onDownload: (message: ChatMessage) => void;
  onOpenContextMenu?: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void;
}) {
  return (
    <button
      type="button"
      className="chat-history-video-thumb"
      onClick={() => onDownload(message)}
      onContextMenu={(event) => onOpenContextMenu?.(event, message)}
      title="下载视频文件"
    >
      <span className="chat-history-video-play">▶</span>
      <strong>{fileNameFromMessage(message, "视频")}</strong>
      <em>
        {senderLabel(message)}
        {message.timeLabel ? ` 路 ${message.timeLabel}` : ""}
        {fileNameFromMessage(message, "") ? ` 路 ${fileNameFromMessage(message, "")}` : ""}
      </em>
    </button>
  );
}

function HistoryImageThumb({
  message,
  showMeta = false,
  onOpenPreview,
  onOpenContextMenu,
}: {
  message: ChatMessage;
  showMeta?: boolean;
  onOpenPreview: (message: ChatMessage) => void;
  onOpenContextMenu?: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void;
}) {
  const fileObjectId = fileObjectIdFromMessage(message);
  const [url, setUrl] = useState(fileObjectId ? "" : fileUrlFromMessage(message));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!fileObjectId) {
      setUrl(fileUrlFromMessage(message));
      return;
    }
    if (url) {
      return;
    }
    let disposed = false;
    let promise = thumbnailCachePromises.get(fileObjectId);
    if (!promise) {
      promise = cacheChatFile(fileObjectId, fileNameFromMessage(message, "图片"));
      thumbnailCachePromises.set(fileObjectId, promise);
    }
    void promise
      .then((nextUrl) => {
        if (!disposed) {
          setUrl(nextUrl);
        }
      })
      .catch(() => {
        thumbnailCachePromises.delete(fileObjectId);
        if (!disposed) {
          setFailed(true);
        }
      });
    return () => {
      disposed = true;
    };
  }, [fileObjectId, message, url]);

  return (
    <button
      type="button"
      className={`chat-history-image-thumb ${showMeta ? "has-meta" : ""}`}
      onClick={() => onOpenPreview(message)}
      onContextMenu={(event) => onOpenContextMenu?.(event, message)}
    >
      {url ? (
        <img src={url} alt={fileNameFromMessage(message, "图片")} />
      ) : failed ? (
        <span>图片加载失败</span>
      ) : (
        <span>图片</span>
      )}
      {showMeta ? (
        <em>
          {senderLabel(message)}
          {message.timeLabel ? ` 路 ${message.timeLabel}` : ""}
          {fileNameFromMessage(message, "") ? ` 路 ${fileNameFromMessage(message, "")}` : ""}
        </em>
      ) : null}
    </button>
  );
}

function HistoryStickerRecord({ message }: { message: ChatMessage }) {
  return (
    <p className="chat-history-text kind-sticker">
      {fileNameFromMessage(message, "[表情]")}
    </p>
  );
}

function HistoryEmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="chat-history-empty">
      <div className="chat-history-empty-icon">∅</div>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

function HistoryContextMenuView({
  menu,
  message,
  onAction,
}: {
  menu: NonNullable<HistoryContextMenu>;
  message: ChatMessage;
  onAction: (
    action: "forward" | "quote" | "delete" | "download" | "open" | "locate",
    message: ChatMessage,
  ) => void;
}) {
  const canDownload =
    message.kind === "image" || message.kind === "file" || isMediaMessage(message);
  const canOpen = message.kind === "file";
  return (
    <div
      className="message-context-menu chat-history-context-menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" onClick={() => onAction("forward", message)}>
        转发
      </button>
      <button type="button" onClick={() => onAction("quote", message)}>
        引用
      </button>
      <button type="button" onClick={() => onAction("locate", message)}>
        定位到聊天位置
      </button>
      {canOpen ? (
        <button type="button" onClick={() => onAction("open", message)}>
          打开
        </button>
      ) : null}
      {canDownload ? (
        <button type="button" onClick={() => onAction("download", message)}>
          下载
        </button>
      ) : null}
      <button
        type="button"
        className="danger"
        onClick={() => onAction("delete", message)}
      >
        删除
      </button>
    </div>
  );
}

function HistoryForwardPicker({
  conversations,
  loading,
  error,
  sendingId,
  source,
  onClose,
  onSelect,
}: {
  conversations: ChatConversation[];
  loading: boolean;
  error?: string | null;
  sendingId?: string | null;
  source: ChatMessage;
  onClose: () => void;
  onSelect: (conversation: ChatConversation) => void;
}) {
  return (
    <div className="chat-modal-backdrop" onClick={onClose}>
      <section className="forward-picker" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>转发给</h2>
          <p>{messagePreview(source)}</p>
        </header>
        <div className="forward-picker-list">
          {error ? <p className="forward-picker-empty is-error">{error}</p> : null}
          {loading && conversations.length === 0 ? (
            <p className="forward-picker-empty">正在加载会话...</p>
          ) : conversations.length > 0 ? (
            conversations.map((conversation) => {
              const avatarUrl = conversation.participant.avatarUrl;
              const avatarLabel =
                conversation.participant.avatar || conversation.title.slice(0, 1);
              return (
                <button
                  key={conversation.id}
                  type="button"
                  disabled={Boolean(sendingId)}
                  onClick={() => onSelect(conversation)}
                >
                  <span className={`history-forward-avatar tone-${conversation.kind}`}>
                    {avatarUrl ? <img src={avatarUrl} alt="" /> : avatarLabel}
                  </span>
                  <span>
                    <strong>{conversation.title}</strong>
                    <em>
                      {sendingId === conversation.id
                        ? "正在转发..."
                        : conversation.subtitle}
                    </em>
                  </span>
                </button>
              );
            })
          ) : (
            <p className="forward-picker-empty">暂无可转发会话</p>
          )}
        </div>
        <footer>
          <button type="button" disabled={Boolean(sendingId)} onClick={onClose}>
            取消
          </button>
        </footer>
      </section>
    </div>
  );
}

function applyHistoryFilter(
  messages: ChatMessage[],
  filter: HistoryFilter,
  query: string,
): ChatMessage[] {
  const normalizedQuery = query.trim().toLowerCase();
  return messages
    .filter((message) => {
      if (message.status === "revoked") {
        return false;
      }
      if (filter === "file") {
        return message.kind === "file";
      }
      if (filter === "media") {
        return isMediaMessage(message);
      }
      return true;
    })
    .filter((message) => {
      if (!normalizedQuery) {
        return true;
      }
      return searchableText(message).toLowerCase().includes(normalizedQuery);
    })
    .sort((left, right) => compareHistoryMessages(right, left));
}

function groupMessagesByDate(messages: ChatMessage[]): Array<{
  key: string;
  label: string;
  messages: ChatMessage[];
}> {
  const groups = new Map<string, { key: string; label: string; messages: ChatMessage[] }>();
  messages.forEach((message) => {
    const key = historyDateKey(message);
    const label = historyDateLabel(message, key);
    const group = groups.get(key) ?? { key, label, messages: [] };
    group.messages.push(message);
    groups.set(key, group);
  });
  return Array.from(groups.values());
}

function historyDateKey(message: ChatMessage): string {
  const date = parseMessageDate(message);
  if (!date) {
    return "unknown";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function historyDateLabel(message: ChatMessage, key: string): string {
  const date = parseMessageDate(message);
  if (!date) {
    return message.kind === "system" && message.content ? message.content : "????";
  }
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) {
    return "??";
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return "??";
  }
  return key.replace(/-/g, "/");
}

function parseMessageDate(message: ChatMessage): Date | null {
  if (message.createdAt) {
    const date = new Date(message.createdAt);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  if (message.kind === "system" && message.content) {
    const normalized = message.content.replace(/\//g, "-");
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return null;
}

function searchableText(message: ChatMessage): string {
  return [
    message.content,
    fileNameFromMessage(message, ""),
    senderLabel(message),
    message.timeLabel,
    contentTypeFromMessage(message),
  ]
    .filter(Boolean)
    .join(" ");
}

function mergeHistoryMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  [...current, ...incoming].forEach((message) => {
    map.set(message.id, message);
  });
  return sortMessages(Array.from(map.values()));
}

function sortMessages(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort(compareHistoryMessages);
}

function compareHistoryMessages(left: ChatMessage, right: ChatMessage): number {
  const leftSeq = left.conversationSeq ?? Number.MAX_SAFE_INTEGER;
  const rightSeq = right.conversationSeq ?? Number.MAX_SAFE_INTEGER;
  if (leftSeq !== rightSeq) {
    return leftSeq - rightSeq;
  }
  return left.id.localeCompare(right.id);
}

function isMediaMessage(message: ChatMessage): boolean {
  if (message.kind === "image") {
    return true;
  }
  if (message.kind !== "file") {
    return false;
  }
  const contentType = contentTypeFromMessage(message).toLowerCase();
  return contentType.startsWith("video/");
}

function senderLabel(message: ChatMessage): string {
  if (message.direction === "outgoing") {
    return "我";
  }
  return "对方";
}

function fileTypeLabel(message: ChatMessage): string {
  const contentType = contentTypeFromMessage(message);
  const fileName = fileNameFromMessage(message, "").toLowerCase();
  if (!contentType) {
    if (fileName.endsWith(".pdf")) {
      return "PDF";
    }
    if (fileName.endsWith(".doc") || fileName.endsWith(".docx")) {
      return "Word";
    }
    if (fileName.endsWith(".xls") || fileName.endsWith(".xlsx")) {
      return "Excel";
    }
    if (fileName.endsWith(".png") || fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) {
      return "图片";
    }
    if (fileName.endsWith(".mp4") || fileName.endsWith(".mov") || fileName.endsWith(".avi")) {
      return "视频";
    }
    return "文件";
  }
  if (contentType.startsWith("image/")) {
    return "图片";
  }
  if (contentType.includes("pdf")) {
    return "PDF";
  }
  if (contentType.includes("word")) {
    return "Word";
  }
  if (contentType.includes("excel") || contentType.includes("sheet")) {
    return "Excel";
  }
  if (contentType.startsWith("video/")) {
    return "视频";
  }
  return "文件";
}

function fileTypeClass(message: ChatMessage): string {
  const label = fileTypeLabel(message);
  if (label === "PDF") {
    return "pdf";
  }
  if (label === "Word") {
    return "word";
  }
  if (label === "Excel") {
    return "excel";
  }
  if (label === "图片") {
    return "image";
  }
  if (label === "视频") {
    return "video";
  }
  return "generic";
}

function emptyTitle(filter: HistoryFilter, query: string): string {
  if (query.trim()) {
    return "没有匹配的聊天记录";
  }
  if (filter === "file") {
    return "暂无文件记录";
  }
  if (filter === "media") {
    return "暂无图片与视频";
  }
  return "暂无聊天记录";
}

function emptyDescription(filter: HistoryFilter, query: string): string {
  if (query.trim()) {
    return "可以换一个关键词，或清除筛选后再试";
  }
  if (filter === "file") {
    return "你和对方发送过的文件会显示在这里";
  }
  if (filter === "media") {
    return "图片与视频会以网格方式显示";
  }
  return "开始聊天后，这里会显示历史内容";
}

function footerText(
  messages: ChatMessage[],
  filteredMessages: ChatMessage[],
  filter: HistoryFilter,
  query: string,
): string {
  if (filter === "all" && !query.trim()) {
    return `已加载 ${messages.length} 条记录`;
  }
  return `筛选出 ${filteredMessages.length} 条 / 已加载 ${messages.length} 条`;
}
