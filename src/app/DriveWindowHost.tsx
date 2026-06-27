import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  createDriveFolder,
  downloadChatFile,
  forwardDriveNodeToChat,
  listDriveNodes,
  loadChatConversations,
  loadChatGroup,
  openCachedChatFile,
  pickChatUploadFiles,
  saveFileToDrive,
  uploadChatFilePathChunked,
} from "../features/chat/chatRepository";
import { formatBytes } from "../features/chat/chatMessageUtils";
import type { ChatConversation, ChatGroup, DriveNode, LocalUploadFile, MediaViewerItem } from "../features/chat/types";
import { DRIVE_OPEN_EVENT } from "../features/settings/windowEvents";

type DrivePanelMode = "personal" | "group";
type DriveFilter = "all" | "image" | "video" | "document" | "archive" | "other";
type DriveViewMode = "list" | "grid";
type DriveSortMode = "updated" | "name" | "size" | "type";

type DriveOpenPayload = {
  mode: DrivePanelMode;
  groupId?: string | null;
  title?: string | null;
  canManage?: boolean | null;
};

type DrivePanelState = {
  mode: DrivePanelMode;
  groupId?: string | null;
  title: string;
  nodes: DriveNode[];
  breadcrumb: DriveNode[];
  loading: boolean;
  error?: string | null;
  search: string;
  filter: DriveFilter;
  viewMode: DriveViewMode;
  sortMode: DriveSortMode;
};

type DriveForwardState = {
  nodeId: string;
  nodeName: string;
} | null;

const DEFAULT_CHAT_CHUNK_SIZE = 4 * 1024 * 1024;

export function DriveWindowHost() {
  const [state, setState] = useState<DrivePanelState>(() => initialDriveState());
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [group, setGroup] = useState<ChatGroup | null>(null);
  const [payloadCanManage, setPayloadCanManage] = useState<boolean | null>(null);
  const [forwardState, setForwardState] = useState<DriveForwardState>(null);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardSendingId, setForwardSendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stateRef = useRef(state);
  const refreshSeqRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const canManage = state.mode === "personal"
    ? true
    : payloadCanManage ??
      (group?.currentUserRole === "owner" || group?.currentUserRole === "admin");

  const openDrive = (payload: DriveOpenPayload) => {
    const mode = payload.mode === "group" ? "group" : "personal";
    const title = payload.title || (mode === "group" ? "群网盘" : "我的网盘");
    setPayloadCanManage(payload.canManage ?? null);
    setGroup(null);
    setState({
      ...initialDriveState(),
      mode,
      groupId: mode === "group" ? payload.groupId ?? null : null,
      title,
    });
  };

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    async function bind() {
      invoke<DriveOpenPayload | null>("get_drive_open_payload")
        .then((payload) => {
          if (!disposed && payload) {
            openDrive(payload);
          }
        })
        .catch(() => undefined);
      unlisten = await listen<DriveOpenPayload>(DRIVE_OPEN_EVENT, (event) => {
        if (!disposed) {
          openDrive(event.payload);
        }
      });
      await refreshConversations();
    }
    void bind();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    void refreshDrive();
    if (state.mode === "group" && state.groupId) {
      void loadChatGroup(state.groupId)
        .then((result) => {
          setGroup(result.group);
          setState((current) => ({
            ...current,
            title: current.title || `${result.group.name} · 群网盘`,
          }));
        })
        .catch(() => undefined);
    }
  }, [state.mode, state.groupId]);

  const refreshConversations = async () => {
    try {
      const items = await loadChatConversations();
      setConversations(items);
    } catch {
      setConversations([]);
    }
  };

  const refreshDrive = async (
    override: Partial<Pick<DrivePanelState, "mode" | "groupId" | "breadcrumb" | "search" | "filter">> = {},
  ) => {
    const requestSeq = refreshSeqRef.current + 1;
    refreshSeqRef.current = requestSeq;
    const snapshot = {
      ...stateRef.current,
      ...override,
    };
    const parent = snapshot.breadcrumb?.[snapshot.breadcrumb.length - 1] ?? null;
    setState((current) => ({ ...current, ...override, loading: true, error: null }));
    try {
      const nodes = await listDriveNodes({
        driveType: snapshot.mode,
        groupId: snapshot.groupId ?? null,
        parentId: parent?.id ?? null,
        keyword: snapshot.search,
        fileType: driveFilterToApiType(snapshot.filter),
      });
      if (refreshSeqRef.current !== requestSeq) {
        return;
      }
      setState((current) => ({
        ...current,
        ...override,
        nodes,
        loading: false,
        error: null,
      }));
    } catch (error) {
      if (refreshSeqRef.current !== requestSeq) {
        return;
      }
      setState((current) => ({
        ...current,
        ...override,
        loading: false,
        error: friendlyError(String(error)),
      }));
    }
  };

  const createFolder = async () => {
    const name = window.prompt("新建文件夹名称", "新建文件夹")?.trim();
    if (!name) {
      return;
    }
    const parent = stateRef.current.breadcrumb[stateRef.current.breadcrumb.length - 1] ?? null;
    try {
      await createDriveFolder({
        driveType: stateRef.current.mode,
        groupId: stateRef.current.groupId ?? null,
        parentId: parent?.id ?? null,
        name,
      });
      await refreshDrive();
    } catch (error) {
      setState((current) => ({ ...current, error: friendlyError(String(error)) }));
    }
  };

  const uploadFiles = async () => {
    try {
      const files = await pickChatUploadFiles({ kind: "file", multiple: true });
      if (files.length === 0) {
        return;
      }
      const parent = stateRef.current.breadcrumb[stateRef.current.breadcrumb.length - 1] ?? null;
      for (const file of files) {
        const uploaded = await uploadChatFilePathChunked({
          filePath: file.path,
          fileType: normalizeLocalUploadKind(file),
          contentType: file.contentType,
          chunkSize: DEFAULT_CHAT_CHUNK_SIZE,
          taskId: `drive-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        });
        await saveFileToDrive({
          driveType: stateRef.current.mode,
          groupId: stateRef.current.groupId ?? null,
          parentId: parent?.id ?? null,
          fileObjectId: uploaded.id,
          name: uploaded.originalName || file.name,
        });
      }
      await refreshDrive();
    } catch (error) {
      setState((current) => ({ ...current, error: friendlyError(String(error)) }));
    }
  };

  const openNode = async (node: DriveNode) => {
    if (node.type === "folder") {
      const breadcrumb = [...stateRef.current.breadcrumb, node];
      setState((current) => ({ ...current, breadcrumb }));
      await refreshDrive({ breadcrumb });
      return;
    }
    if (isDriveMediaNode(node)) {
      openDriveMediaViewer(node);
      return;
    }
    if (!node.fileObjectId) {
      return;
    }
    try {
      await openCachedChatFile(node.fileObjectId, node.name, {
        source: "drive",
        driveNodeId: node.id,
      });
    } catch (error) {
      setState((current) => ({ ...current, error: friendlyError(String(error)) }));
    }
  };

  const openDriveMediaViewer = (node: DriveNode) => {
    if (!node.fileObjectId) {
      return;
    }
    const visibleNodes = sortDriveNodes(
      filterDriveNodes(stateRef.current.nodes, stateRef.current.filter),
      stateRef.current.sortMode,
    );
    const mediaNodes = visibleNodes.some((item) => item.id === node.id)
      ? visibleNodes
      : [node, ...visibleNodes];
    const mediaList = mediaNodes
      .filter(isDriveMediaNode)
      .map((item): MediaViewerItem => ({
        id: item.id,
        messageId: item.id,
        conversationId: stateRef.current.groupId ?? `drive-${stateRef.current.mode}`,
        sourceMessageId: null,
        messageFileRefId: null,
        source: stateRef.current.mode === "group" ? "group_drive" : "personal_drive",
        sourceId: item.id,
        type: driveNodeFileTone(item) === "image" ? "image" : "video",
        localPosterUrl: null,
        fileObjectId: item.fileObjectId ?? null,
        thumbnailObjectId: null,
        fileName: item.name,
        fileSize: item.file?.sizeBytes ?? null,
        width: item.file?.width ?? null,
        height: item.file?.height ?? null,
        duration: item.file?.durationSeconds ?? null,
        senderId: item.createdByUserId ?? null,
        senderName: null,
        sentAt: item.updatedAt ?? item.createdAt ?? null,
        seq: null,
        localCandidates: [],
      }));
    void invoke("open_media_viewer_window", {
      payload: {
        conversationId: stateRef.current.groupId ?? `drive-${stateRef.current.mode}`,
        conversationTitle: stateRef.current.title,
        activeId: node.id,
        currentIndex: Math.max(0, mediaList.findIndex((item) => item.id === node.id)),
        mediaList,
      },
    });
  };

  const downloadNode = async (node: DriveNode) => {
    if (node.type !== "file" || !node.fileObjectId) {
      return;
    }
    try {
      const result = await downloadChatFile(node.fileObjectId, node.name, {
        source: "drive",
        driveNodeId: node.id,
      });
      if (!result.cancelled) {
        setNotice(result.path ? `已下载到 ${result.path}` : "已下载");
        window.setTimeout(() => setNotice(null), 2400);
      }
    } catch (error) {
      setState((current) => ({ ...current, error: friendlyError(String(error)) }));
    }
  };

  const navigateBreadcrumb = async (index: number) => {
    const breadcrumb = index < 0 ? [] : stateRef.current.breadcrumb.slice(0, index + 1);
    setState((current) => ({ ...current, breadcrumb }));
    await refreshDrive({ breadcrumb });
  };

  const forwardNode = async (conversation: ChatConversation) => {
    if (!forwardState || forwardSendingId) {
      return;
    }
    try {
      setForwardSendingId(conversation.id);
      await forwardDriveNodeToChat(forwardState.nodeId, conversation.id);
      setForwardState(null);
      setForwardSearch("");
      setNotice("已转发到聊天");
      window.setTimeout(() => setNotice(null), 2200);
    } catch (error) {
      setState((current) => ({ ...current, error: friendlyError(String(error)) }));
    } finally {
      setForwardSendingId(null);
    }
  };

  return (
    <main className="drive-window-root">
      <DrivePanelView
        state={state}
        canManage={canManage}
        onClose={() => void getCurrentWindow().hide()}
        onRefresh={() => void refreshDrive()}
        onSearch={(search) => {
          setState((current) => ({ ...current, search }));
          void refreshDrive({ search });
        }}
        onFilter={(filter) => {
          setState((current) => ({ ...current, filter }));
          void refreshDrive({ filter });
        }}
        onSort={(sortMode) => setState((current) => ({ ...current, sortMode }))}
        onViewMode={(viewMode) => setState((current) => ({ ...current, viewMode }))}
        onCreateFolder={() => void createFolder()}
        onUpload={() => void uploadFiles()}
        onOpenNode={(node) => void openNode(node)}
        onDownloadNode={(node) => void downloadNode(node)}
        onForwardNode={(node) => setForwardState({ nodeId: node.id, nodeName: node.name })}
        onBreadcrumb={(index) => void navigateBreadcrumb(index)}
      />

      {forwardState ? (
        <DriveForwardPickerDialog
          conversations={conversations}
          nodeName={forwardState.nodeName}
          search={forwardSearch}
          sendingId={forwardSendingId}
          onSearchChange={setForwardSearch}
          onClose={() => {
            if (!forwardSendingId) {
              setForwardState(null);
              setForwardSearch("");
            }
          }}
          onSelect={(conversation) => void forwardNode(conversation)}
        />
      ) : null}

      {notice ? <div className="drive-save-toast">{notice}</div> : null}
    </main>
  );
}

function DrivePanelView({
  state,
  canManage,
  onClose,
  onRefresh,
  onSearch,
  onFilter,
  onSort,
  onViewMode,
  onCreateFolder,
  onUpload,
  onOpenNode,
  onDownloadNode,
  onForwardNode,
  onBreadcrumb,
}: {
  state: DrivePanelState;
  canManage: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onSearch: (search: string) => void;
  onFilter: (filter: DriveFilter) => void;
  onSort: (sortMode: DriveSortMode) => void;
  onViewMode: (viewMode: DriveViewMode) => void;
  onCreateFolder: () => void;
  onUpload: () => void;
  onOpenNode: (node: DriveNode) => void;
  onDownloadNode: (node: DriveNode) => void;
  onForwardNode: (node: DriveNode) => void;
  onBreadcrumb: (index: number) => void;
}) {
  const sortedNodes = sortDriveNodes(filterDriveNodes(state.nodes, state.filter), state.sortMode);
  const filters: Array<[DriveFilter, string]> = [
    ["all", "全部"],
    ["image", "图片"],
    ["video", "视频"],
    ["document", "文档"],
    ["archive", "压缩包"],
    ["other", "其他"],
  ];
  return (
    <section className={`drive-panel-view is-${state.mode}`}>
      <header className="drive-panel-header">
        <div>
          <h2>{state.title}</h2>
          <p>{state.mode === "group" ? "群内长期资料沉淀，不自动收纳聊天文件" : "个人长期文件资产"}</p>
        </div>
        <div className="drive-panel-actions">
          <button type="button" onClick={onRefresh}>刷新</button>
          {canManage ? (
            <>
              <button type="button" onClick={onCreateFolder}>新建文件夹</button>
              <button type="button" className="profile-primary-button" onClick={onUpload}>
                上传文件
              </button>
            </>
          ) : null}
          <button type="button" onClick={onClose}>关闭</button>
        </div>
      </header>
      <div className="drive-toolbar">
        <label className="drive-search">
          <span className="drive-search-icon">⌕</span>
          <input
            value={state.search}
            placeholder={state.mode === "group" ? "搜索群文件..." : "搜索文件..."}
            onChange={(event) => onSearch(event.currentTarget.value)}
          />
        </label>
        <select value={state.sortMode} onChange={(event) => onSort(event.currentTarget.value as DriveSortMode)}>
          <option value="updated">按修改时间</option>
          <option value="name">按名称</option>
          <option value="size">按大小</option>
          <option value="type">按类型</option>
        </select>
        <div className="drive-view-toggle">
          <button
            type="button"
            className={state.viewMode === "list" ? "is-active" : ""}
            onClick={() => onViewMode("list")}
          >
            列表
          </button>
          <button
            type="button"
            className={state.viewMode === "grid" ? "is-active" : ""}
            onClick={() => onViewMode("grid")}
          >
            宫格
          </button>
        </div>
      </div>
      <nav className="drive-filter-row">
        {filters.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={state.filter === key ? "is-active" : ""}
            onClick={() => onFilter(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="drive-breadcrumb">
        <button type="button" onClick={() => onBreadcrumb(-1)}>
          {state.mode === "group" ? "群网盘" : "我的网盘"}
        </button>
        {state.breadcrumb.map((node, index) => (
          <Fragment key={node.id}>
            <span>›</span>
            <button type="button" onClick={() => onBreadcrumb(index)}>
              {node.name}
            </button>
          </Fragment>
        ))}
      </div>
      {state.error ? <p className="drive-error">{state.error}</p> : null}
      {state.loading ? (
        <div className="drive-empty">正在加载网盘...</div>
      ) : sortedNodes.length > 0 ? (
        <div className={`drive-node-list is-${state.viewMode}`}>
          {sortedNodes.map((node) => (
            <DriveNodeCard
              key={node.id}
              node={node}
              viewMode={state.viewMode}
              onOpen={() => onOpenNode(node)}
              onDownload={() => onDownloadNode(node)}
              onForward={() => onForwardNode(node)}
            />
          ))}
        </div>
      ) : (
        <div className="drive-empty">
          <strong>这里还没有文件</strong>
          <span>{canManage ? "可以上传文件或新建文件夹" : "暂无可查看的群文件"}</span>
        </div>
      )}
    </section>
  );
}

function DriveNodeCard({
  node,
  viewMode,
  onOpen,
  onDownload,
  onForward,
}: {
  node: DriveNode;
  viewMode: DriveViewMode;
  onOpen: () => void;
  onDownload: () => void;
  onForward: () => void;
}) {
  const isFolder = node.type === "folder";
  const size = node.file?.sizeBytes ?? 0;
  const updated = formatDriveDate(node.updatedAt || node.createdAt);
  return (
    <article className={`drive-node-card is-${viewMode}`} onDoubleClick={onOpen}>
      <button type="button" className="drive-node-main" onClick={onOpen}>
        <span className={`drive-node-icon tone-${isFolder ? "folder" : driveNodeFileTone(node)}`}>
          {isFolder ? "F" : driveNodeShortLabel(node)}
        </span>
        <span>
          <strong title={node.name}>{node.name}</strong>
          <em>
            {isFolder ? "文件夹" : `${fileKindLabel(node.name)} · ${size ? formatBytes(size) : "未知大小"}`}
          </em>
        </span>
      </button>
      {viewMode === "list" ? (
        <>
          <span className="drive-node-date">{updated}</span>
          <span className="drive-node-size">{isFolder ? "--" : formatBytes(size)}</span>
        </>
      ) : null}
      <footer>
        {!isFolder ? <button type="button" onClick={onDownload}>下载</button> : null}
        {!isFolder ? <button type="button" onClick={onForward}>转发</button> : null}
        <button type="button" onClick={onOpen}>{isFolder ? "打开" : "预览"}</button>
      </footer>
    </article>
  );
}

function DriveForwardPickerDialog({
  conversations,
  nodeName,
  search,
  sendingId,
  onSearchChange,
  onClose,
  onSelect,
}: {
  conversations: ChatConversation[];
  nodeName: string;
  search: string;
  sendingId: string | null;
  onSearchChange: (value: string) => void;
  onClose: () => void;
  onSelect: (conversation: ChatConversation) => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = normalizedSearch
    ? conversations.filter((conversation) =>
        `${conversation.title} ${conversation.subtitle}`.toLowerCase().includes(normalizedSearch),
      )
    : conversations;
  return (
    <div className="chat-modal-backdrop card-share-backdrop" onClick={onClose}>
      <section className="card-share-dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <span>
            <h2>转发网盘文件</h2>
            <p>{nodeName}</p>
          </span>
          <button type="button" disabled={Boolean(sendingId)} onClick={onClose}>×</button>
        </header>
        <label className="card-share-search">
          <span>搜索</span>
          <input
            value={search}
            placeholder="搜索好友或群聊"
            onChange={(event) => onSearchChange(event.currentTarget.value)}
          />
        </label>
        <div className="card-share-list">
          {filtered.length > 0 ? (
            filtered.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                disabled={Boolean(sendingId)}
                onClick={() => onSelect(conversation)}
              >
                <span className={`chat-avatar tone-${conversation.kind}`}>
                  <span className="chat-avatar-label">
                    {conversation.participant.avatar || conversation.title.slice(0, 1)}
                  </span>
                  {conversation.participant.avatarUrl ? (
                    <img src={conversation.participant.avatarUrl} alt="" draggable={false} />
                  ) : null}
                </span>
                <span>
                  <strong>{conversation.title}</strong>
                  <em>{sendingId === conversation.id ? "正在转发..." : conversation.subtitle || "聊天"}</em>
                </span>
              </button>
            ))
          ) : (
            <p className="card-share-empty">没有匹配的会话</p>
          )}
        </div>
      </section>
    </div>
  );
}

function initialDriveState(): DrivePanelState {
  return {
    mode: "personal",
    groupId: null,
    title: "我的网盘",
    nodes: [],
    breadcrumb: [],
    loading: false,
    error: null,
    search: "",
    filter: "all",
    viewMode: "list",
    sortMode: "updated",
  };
}

function normalizeLocalUploadKind(
  file: Pick<LocalUploadFile, "fileType" | "contentType" | "name">,
): "image" | "video" | "file" {
  if (file.fileType === "image" || file.fileType === "video") {
    return file.fileType;
  }
  return detectKindFromName(file.name, file.contentType);
}

function detectKindFromName(
  name: string,
  contentType: string,
  fallback: "image" | "video" | "file" = "file",
): "image" | "video" | "file" {
  const lower = name.toLowerCase();
  if (contentType.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(lower)) {
    return "image";
  }
  if (contentType.startsWith("video/") || /\.(mp4|mov|webm|avi|mkv)$/i.test(lower)) {
    return "video";
  }
  return fallback;
}

function driveFilterToApiType(filter: DriveFilter): string {
  if (filter === "image" || filter === "video") {
    return filter;
  }
  return "all";
}

function sortDriveNodes(nodes: DriveNode[], sortMode: DriveSortMode): DriveNode[] {
  return [...nodes].sort((left, right) => {
    if (left.type === "folder" && right.type !== "folder") return -1;
    if (left.type !== "folder" && right.type === "folder") return 1;
    if (sortMode === "name") return left.name.localeCompare(right.name, "zh-Hans-CN");
    if (sortMode === "size") return (right.file?.sizeBytes ?? 0) - (left.file?.sizeBytes ?? 0);
    if (sortMode === "type") {
      return fileKindLabel(left.name).localeCompare(fileKindLabel(right.name), "zh-Hans-CN");
    }
    return dateValue(right.updatedAt || right.createdAt) - dateValue(left.updatedAt || left.createdAt);
  });
}

function filterDriveNodes(nodes: DriveNode[], filter: DriveFilter): DriveNode[] {
  if (filter === "all") return nodes;
  return nodes.filter((node) => {
    if (node.type === "folder") return true;
    const tone = driveNodeFileTone(node);
    if (filter === "image") return tone === "image";
    if (filter === "video") return tone === "video";
    if (filter === "archive") return tone === "archive";
    if (filter === "document") return tone === "document";
    if (filter === "other") return !["image", "video", "archive", "document"].includes(tone);
    return true;
  });
}

function dateValue(value?: string | null): number {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatDriveDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${date
    .getHours()
    .toString()
    .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function fileKindLabel(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (/\.(doc|docx)$/i.test(lower)) return "Word 文档";
  if (/\.(xls|xlsx)$/i.test(lower)) return "表格";
  if (/\.(ppt|pptx)$/i.test(lower)) return "演示文稿";
  if (/\.pdf$/i.test(lower)) return "PDF";
  if (/\.(zip|rar|7z|tar|gz)$/i.test(lower)) return "压缩包";
  if (/\.(mp4|mov|webm|avi|mkv)$/i.test(lower)) return "视频";
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(lower)) return "图片";
  return "文件";
}

function driveNodeFileTone(node: DriveNode): string {
  const type = node.file?.fileType || detectKindFromName(node.name, node.file?.contentType || "");
  if (type === "image") return "image";
  if (type === "video") return "video";
  if (fileKindLabel(node.name) === "压缩包") return "archive";
  if (["Word 文档", "表格", "演示文稿", "PDF"].includes(fileKindLabel(node.name))) {
    return "document";
  }
  return "file";
}

function isDriveMediaNode(node: DriveNode): boolean {
  if (node.type !== "file" || !node.fileObjectId) return false;
  const tone = driveNodeFileTone(node);
  return tone === "image" || tone === "video";
}

function driveNodeShortLabel(node: DriveNode): string {
  const tone = driveNodeFileTone(node);
  if (tone === "video") return "V";
  if (tone === "image") return "I";
  if (tone === "archive") return "Z";
  if (tone === "document") return "D";
  return "F";
}

function friendlyError(error: string): string {
  if (error.includes("Not authenticated")) {
    return "登录状态已失效，请重新登录";
  }
  if (error.includes("Permission denied") || error.includes("Forbidden")) {
    return "当前账号没有操作权限";
  }
  return error;
}
