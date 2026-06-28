import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  createDriveFolder,
  downloadChatFile,
  forwardDriveNodeToChat,
  listLocalFileCandidates,
  listDriveNodes,
  loadChatConversations,
  loadChatGroup,
  openChatFileLocalFirst,
  pickChatUploadFiles,
  rememberLocalFileCandidate,
  saveFileToDrive,
  uploadChatFilePathChunked,
} from "../features/chat/chatRepository";
import { formatBytes } from "../features/chat/chatMessageUtils";
import type {
  ChatConversation,
  ChatGroup,
  DriveNode,
  LocalUploadFile,
  MediaViewerItem,
  MediaViewerLocalCandidate,
} from "../features/chat/types";
import { DRIVE_OPEN_EVENT } from "../features/settings/windowEvents";
import DownloadIcon from "../../images/netdisk/download.svg";
import FileIcon from "../../images/netdisk/file.svg";
import FileTextIcon from "../../images/netdisk/file-text.svg";
import FileDocIcon from "../../images/netdisk/file-type-doc.svg";
import FileDocxIcon from "../../images/netdisk/file-type-docx.svg";
import FilePdfIcon from "../../images/netdisk/file-type-pdf.svg";
import FilePptIcon from "../../images/netdisk/file-type-ppt.svg";
import FileXlsIcon from "../../images/netdisk/file-type-xls.svg";
import FileZipIcon from "../../images/netdisk/file-type-zip.svg";
import FolderIcon from "../../images/netdisk/folder.svg";
import GridIcon from "../../images/netdisk/layout-grid.svg";
import ListIcon from "../../images/netdisk/layout-list.svg";
import MoreIcon from "../../images/netdisk/dots.svg";
import MusicIcon from "../../images/netdisk/music.svg";
import PhotoIcon from "../../images/netdisk/photo.svg";
import PreviewIcon from "../../images/netdisk/eye.svg";
import RefreshIcon from "../../images/netdisk/refresh.svg";
import SearchIcon from "../../images/netdisk/search (1).svg";
import ShareIcon from "../../images/netdisk/share-3.svg";
import SortIcon from "../../images/netdisk/sort-descending.svg";
import UploadIcon from "../../images/netdisk/upload.svg";
import VideoIcon from "../../images/netdisk/video.svg";

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

type DriveFolderDialogState = {
  open: boolean;
  name: string;
  submitting: boolean;
  error: string | null;
};

const DEFAULT_CHAT_CHUNK_SIZE = 4 * 1024 * 1024;
const INVALID_FOLDER_NAME_PATTERN = /[\\/:*?"<>|]/;

export function DriveWindowHost() {
  const [state, setState] = useState<DrivePanelState>(() => initialDriveState());
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [group, setGroup] = useState<ChatGroup | null>(null);
  const [payloadCanManage, setPayloadCanManage] = useState<boolean | null>(null);
  const [forwardState, setForwardState] = useState<DriveForwardState>(null);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardSendingId, setForwardSendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<DriveFolderDialogState>({
    open: false,
    name: "",
    submitting: false,
    error: null,
  });
  const stateRef = useRef(state);
  const refreshSeqRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const canManage = state.mode === "personal"
    ? true
    : payloadCanManage ??
      (group?.currentUserRole === "owner" || group?.currentUserRole === "admin");
  const canForward = state.mode === "personal" || canManage;

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

  const openCreateFolderDialog = () => {
    setFolderDialog({
      open: true,
      name: "",
      submitting: false,
      error: null,
    });
  };

  const closeCreateFolderDialog = () => {
    setFolderDialog((current) => (
      current.submitting
        ? current
        : {
            open: false,
            name: "",
            submitting: false,
            error: null,
          }
    ));
  };

  const updateFolderDialogName = (name: string) => {
    setFolderDialog((current) => ({
      ...current,
      name,
      error: current.error ? null : current.error,
    }));
  };

  const createFolder = async () => {
    const name = folderDialog.name.trim();
    const validationError = validateFolderName(name);
    if (validationError) {
      setFolderDialog((current) => ({ ...current, error: validationError }));
      return;
    }
    const parent = stateRef.current.breadcrumb[stateRef.current.breadcrumb.length - 1] ?? null;
    setFolderDialog((current) => ({ ...current, submitting: true, error: null }));
    try {
      await createDriveFolder({
        driveType: stateRef.current.mode,
        groupId: stateRef.current.groupId ?? null,
        parentId: parent?.id ?? null,
        name,
      });
      setFolderDialog({
        open: false,
        name: "",
        submitting: false,
        error: null,
      });
      setNotice("文件夹已创建");
      window.setTimeout(() => setNotice(null), 2200);
      await refreshDrive();
    } catch (error) {
      setFolderDialog((current) => ({
        ...current,
        submitting: false,
        error: friendlyError(String(error)),
      }));
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
        const node = await saveFileToDrive({
          driveType: stateRef.current.mode,
          groupId: stateRef.current.groupId ?? null,
          parentId: parent?.id ?? null,
          fileObjectId: uploaded.id,
          name: uploaded.originalName || file.name,
        });
        await rememberLocalFileCandidate({
          fileObjectId: uploaded.id,
          driveNodeId: node.id,
          sourceType: "local_original",
          localPath: file.path,
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
      await openDriveMediaViewer(node);
      return;
    }
    if (!node.fileObjectId) {
      return;
    }
    try {
      await openChatFileLocalFirst(node.fileObjectId, node.name, {
        source: "drive",
        driveNodeId: node.id,
      });
    } catch (error) {
      setState((current) => ({ ...current, error: friendlyError(String(error)) }));
    }
  };

  const openDriveMediaViewer = async (node: DriveNode) => {
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
    const candidateMap = new Map<string, MediaViewerLocalCandidate[]>();
    await Promise.all(
      mediaNodes.filter(isDriveMediaNode).map(async (item) => {
        if (!item.fileObjectId) {
          return;
        }
        try {
          const candidates = await listLocalFileCandidates({
            fileObjectId: item.fileObjectId,
            driveNodeId: item.id,
          });
          candidateMap.set(
            item.id,
            candidates.map((candidate) => ({
              path: candidate.path,
              sourceType: candidate.sourceType ?? "local_original",
            })),
          );
        } catch {
          candidateMap.set(item.id, []);
        }
      }),
    );
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
        localCandidates: candidateMap.get(item.id) ?? [],
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
    if (!forwardState || forwardSendingId || !canForward) {
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
        onCreateFolder={openCreateFolderDialog}
        onUpload={() => void uploadFiles()}
        onOpenNode={(node) => void openNode(node)}
        onDownloadNode={(node) => void downloadNode(node)}
        onForwardNode={(node) => setForwardState({ nodeId: node.id, nodeName: node.name })}
        onBreadcrumb={(index) => void navigateBreadcrumb(index)}
        canForward={canForward}
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

      {folderDialog.open ? (
        <DriveFolderDialog
          name={folderDialog.name}
          submitting={folderDialog.submitting}
          error={folderDialog.error}
          onNameChange={updateFolderDialogName}
          onClose={closeCreateFolderDialog}
          onSubmit={() => void createFolder()}
        />
      ) : null}

      {notice ? <div className="drive-save-toast">{notice}</div> : null}
    </main>
  );
}

function DrivePanelView({
  state,
  canManage,
  canForward,
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
  canForward: boolean;
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
  const [openMenuNodeId, setOpenMenuNodeId] = useState<string | null>(null);
  const filters: Array<[DriveFilter, string]> = [
    ["all", "全部"],
    ["image", "图片"],
    ["video", "视频"],
    ["document", "文档"],
    ["archive", "压缩包"],
    ["other", "其他"],
  ];
  const rootLabel = state.mode === "group" ? "群网盘" : "我的网盘";
  const subtitle = state.mode === "group"
    ? "群内长期资料沉淀，不自动收纳聊天文件"
    : "个人长期文件资产";
  useEffect(() => {
    setOpenMenuNodeId(null);
  }, [state.viewMode, state.filter, state.sortMode, state.search, state.breadcrumb]);

  useEffect(() => {
    if (!openMenuNodeId) {
      return;
    }
    const closeMenu = () => setOpenMenuNodeId(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [openMenuNodeId]);

  return (
    <section className={`drive-panel-view is-${state.mode}`}>
      <header className="drive-panel-header">
        <div>
          <h2>{state.title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="drive-panel-actions">
          {canManage ? (
            <>
              <button type="button" className="drive-action-button" onClick={onCreateFolder}>
                <Icon src={FolderIcon} alt="" />
                新建文件夹
              </button>
              <button type="button" className="drive-action-button is-primary" onClick={onUpload}>
                <Icon src={UploadIcon} alt="" />
                上传文件
              </button>
            </>
          ) : null}
        </div>
      </header>
      <div className="drive-toolbar">
        <label className="drive-search">
          <Icon src={SearchIcon} alt="" />
          <input
            value={state.search}
            placeholder={state.mode === "group" ? "搜索群文件..." : "搜索文件..."}
            onChange={(event) => onSearch(event.currentTarget.value)}
          />
        </label>
        <label className="drive-sort-select" title="排序方式">
          <Icon src={SortIcon} alt="" />
          <select value={state.sortMode} onChange={(event) => onSort(event.currentTarget.value as DriveSortMode)}>
            <option value="updated">按修改时间</option>
            <option value="name">按名称</option>
            <option value="size">按大小</option>
            <option value="type">按类型</option>
          </select>
        </label>
        <div className="drive-view-toggle">
          <button
            type="button"
            title="列表视图"
            className={state.viewMode === "list" ? "is-active" : ""}
            onClick={() => onViewMode("list")}
          >
            <Icon src={ListIcon} alt="" />
          </button>
          <button
            type="button"
            title="宫格视图"
            className={state.viewMode === "grid" ? "is-active" : ""}
            onClick={() => onViewMode("grid")}
          >
            <Icon src={GridIcon} alt="" />
          </button>
        </div>
        <button type="button" className="drive-icon-button" title="刷新" onClick={onRefresh}>
          <Icon src={RefreshIcon} alt="" />
        </button>
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
          {rootLabel}
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
              canForward={canForward}
              menuOpen={openMenuNodeId === node.id}
              onOpen={() => onOpenNode(node)}
              onDownload={() => onDownloadNode(node)}
              onForward={() => onForwardNode(node)}
              onToggleMenu={(event) => {
                event.stopPropagation();
                setOpenMenuNodeId((current) => (current === node.id ? null : node.id));
              }}
              onCloseMenu={() => setOpenMenuNodeId(null)}
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
  canForward,
  menuOpen,
  onOpen,
  onDownload,
  onForward,
  onToggleMenu,
  onCloseMenu,
}: {
  node: DriveNode;
  viewMode: DriveViewMode;
  canForward: boolean;
  menuOpen: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onForward: () => void;
  onToggleMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onCloseMenu: () => void;
}) {
  const isFolder = node.type === "folder";
  const size = node.file?.sizeBytes ?? 0;
  const updated = formatDriveDate(node.updatedAt || node.createdAt);
  const typeLabel = isFolder ? "文件夹" : fileKindLabel(node.name);
  return (
    <article className={`drive-node-card is-${viewMode}`} onDoubleClick={onOpen}>
      <button type="button" className="drive-node-main" onClick={onOpen}>
        <span className={`drive-node-icon tone-${isFolder ? "folder" : driveNodeIconTone(node)}`}>
          <DriveFileIcon node={node} />
        </span>
        <span>
          <strong title={node.name}>{node.name}</strong>
          <em>{typeLabel}</em>
        </span>
      </button>
      {viewMode === "list" ? (
        <>
          <span className="drive-node-date">{updated}</span>
          <span className="drive-node-size">{isFolder ? "--" : formatBytes(size)}</span>
        </>
      ) : null}
      <footer className="drive-node-actions">
        <button
          type="button"
          className="drive-row-action"
          title={isFolder ? "打开" : "预览"}
          aria-label={isFolder ? "打开" : "预览"}
          onClick={onOpen}
        >
          <Icon src={isFolder ? FolderIcon : PreviewIcon} alt="" />
        </button>
        {!isFolder ? (
          <span className="drive-more-wrap">
            <button
              type="button"
              className={`drive-row-action ${menuOpen ? "is-active" : ""}`}
              title="更多"
              aria-label="更多"
              aria-expanded={menuOpen}
              onClick={onToggleMenu}
            >
              <Icon src={MoreIcon} alt="" />
            </button>
            {menuOpen ? (
              <span className="drive-more-menu" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => {
                    onCloseMenu();
                    onDownload();
                  }}
                >
                  <Icon src={DownloadIcon} alt="" />
                  <span>下载</span>
                </button>
                {canForward ? (
                  <button
                    type="button"
                    onClick={() => {
                      onCloseMenu();
                      onForward();
                    }}
                  >
                    <Icon src={ShareIcon} alt="" />
                    <span>转发</span>
                  </button>
                ) : null}
              </span>
            ) : null}
          </span>
        ) : null}
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

function DriveFolderDialog({
  name,
  submitting,
  error,
  onNameChange,
  onClose,
  onSubmit,
}: {
  name: string;
  submitting: boolean;
  error: string | null;
  onNameChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canSubmit = name.trim().length > 0 && !submitting;

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (canSubmit) {
          onSubmit();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [canSubmit, onClose, onSubmit]);

  return (
    <div className="drive-folder-dialog-backdrop" role="presentation">
      <section
        className="drive-folder-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drive-folder-dialog-title"
      >
        <header>
          <h2 id="drive-folder-dialog-title">新建文件夹</h2>
          <button type="button" title="关闭" disabled={submitting} onClick={onClose}>
            ×
          </button>
        </header>
        <label className={`drive-folder-input ${error ? "has-error" : ""}`}>
          <input
            ref={inputRef}
            value={name}
            placeholder="请输入文件夹名称"
            maxLength={50}
            disabled={submitting}
            onChange={(event) => onNameChange(event.currentTarget.value)}
          />
        </label>
        <p className={`drive-folder-dialog-error ${error ? "is-visible" : ""}`}>
          {error || " "}
        </p>
        <footer>
          <button type="button" className="drive-folder-cancel" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="drive-folder-confirm"
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {submitting ? "创建中..." : "确定"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function Icon({ src, alt }: { src: string; alt: string }) {
  return <img className="drive-svg-icon" src={src} alt={alt} draggable={false} />;
}

type DriveFileIconStyle = CSSProperties & {
  "--drive-file-icon-url": string;
};

function DriveFileIcon({ node }: { node: DriveNode }) {
  const style: DriveFileIconStyle = {
    "--drive-file-icon-url": `url("${driveNodeIcon(node)}")`,
  };
  return <span className="drive-file-glyph" style={style} aria-hidden="true" />;
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
  const key = fileKindKey(fileName);
  if (key === "doc" || key === "docx") return "Word 文档";
  if (key === "xls") return "表格";
  if (key === "ppt") return "演示文稿";
  if (key === "pdf") return "PDF";
  if (key === "archive") return "压缩包";
  if (key === "video") return "视频";
  if (key === "image") return "图片";
  if (key === "audio") return "音频";
  if (key === "text") return "文本文档";
  return "文件";
}

function driveNodeFileTone(node: DriveNode): string {
  const type = node.file?.fileType || detectKindFromName(node.name, node.file?.contentType || "");
  if (type === "image") return "image";
  if (type === "video") return "video";
  const key = fileKindKey(node.name);
  if (key === "archive") return "archive";
  if (["doc", "docx", "xls", "ppt", "pdf", "text"].includes(key)) {
    return "document";
  }
  if (key === "audio") return "audio";
  return "file";
}

function isDriveMediaNode(node: DriveNode): boolean {
  if (node.type !== "file" || !node.fileObjectId) return false;
  const tone = driveNodeFileTone(node);
  return tone === "image" || tone === "video";
}

function driveNodeIcon(node: DriveNode): string {
  if (node.type === "folder") return FolderIcon;
  const key = fileKindKey(node.name);
  if (key === "video") return VideoIcon;
  if (key === "image") return PhotoIcon;
  if (key === "doc") return FileDocIcon;
  if (key === "docx") return FileDocxIcon;
  if (key === "pdf") return FilePdfIcon;
  if (key === "ppt") return FilePptIcon;
  if (key === "xls") return FileXlsIcon;
  if (key === "archive") return FileZipIcon;
  if (key === "audio") return MusicIcon;
  if (key === "text") return FileTextIcon;
  const type = node.file?.fileType || detectKindFromName(node.name, node.file?.contentType || "");
  if (type === "video") return VideoIcon;
  if (type === "image") return PhotoIcon;
  return FileIcon;
}

function driveNodeIconTone(node: DriveNode): string {
  if (node.type === "folder") return "folder";
  const key = fileKindKey(node.name);
  if (key === "video") return "video";
  if (key === "image") return "image";
  if (key === "xls") return "spreadsheet";
  if (key === "ppt") return "presentation";
  if (key === "archive") return "archive";
  if (key === "doc" || key === "docx" || key === "pdf" || key === "text") {
    return "document";
  }
  if (key === "audio") return "audio";
  const type = node.file?.fileType || detectKindFromName(node.name, node.file?.contentType || "");
  if (type === "video") return "video";
  if (type === "image") return "image";
  return "file";
}

function fileKindKey(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (/\.doc$/i.test(lower)) return "doc";
  if (/\.docx$/i.test(lower)) return "docx";
  if (/\.(xls|xlsx)$/i.test(lower)) return "xls";
  if (/\.(ppt|pptx)$/i.test(lower)) return "ppt";
  if (/\.pdf$/i.test(lower)) return "pdf";
  if (/\.(zip|rar|7z|tar|gz)$/i.test(lower)) return "archive";
  if (/\.(mp4|mov|webm|avi|mkv)$/i.test(lower)) return "video";
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(lower)) return "image";
  if (/\.(mp3|wav|flac|aac|m4a|ogg)$/i.test(lower)) return "audio";
  if (/\.(txt|md|json|csv)$/i.test(lower)) return "text";
  return "file";
}

function validateFolderName(name: string): string | null {
  if (!name) {
    return "请输入文件夹名称";
  }
  if (name.length > 50) {
    return "文件夹名称不能超过 50 个字符";
  }
  if (INVALID_FOLDER_NAME_PATTERN.test(name)) {
    return '文件夹名称不能包含 \\ / : * ? " < > |';
  }
  return null;
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
