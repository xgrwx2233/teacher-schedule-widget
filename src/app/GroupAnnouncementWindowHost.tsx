import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChatGroupAnnouncement,
  deleteChatGroupAnnouncement,
  listChatGroupAnnouncements,
  listenForGroupEvents,
  updateChatGroupAnnouncement,
} from "../features/chat/chatRepository";
import type { ChatGroupAnnouncement } from "../features/chat/types";
import {
  GROUP_ANNOUNCEMENT_OPEN_EVENT,
} from "../features/settings/windowEvents";

type GroupAnnouncementOpenPayload = {
  groupId: string;
  groupName: string;
  currentUserRole?: string | null;
};

type EditorState =
  | { mode: "create"; content: string }
  | { mode: "edit"; announcement: ChatGroupAnnouncement; content: string }
  | null;

const ANNOUNCEMENT_MAX_LENGTH = 2000;

export function GroupAnnouncementWindowHost() {
  const [context, setContext] = useState<GroupAnnouncementOpenPayload | null>(null);
  const [announcements, setAnnouncements] = useState<ChatGroupAnnouncement[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [maxCount, setMaxCount] = useState(3);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [error, setError] = useState<string | null>(null);
  const contextRef = useRef<GroupAnnouncementOpenPayload | null>(null);
  const announcementsRef = useRef<ChatGroupAnnouncement[]>([]);
  const loadingGroupIdRef = useRef<string | null>(null);
  const loadedGroupIdRef = useRef<string | null>(null);

  const sortedAnnouncements = useMemo(
    () => [...announcements].sort(compareAnnouncements),
    [announcements],
  );
  const canManageFromOpenPayload = isGroupAnnouncementManager(context?.currentUserRole);
  const canManageAnnouncements = canManage || canManageFromOpenPayload;

  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  useEffect(() => {
    announcementsRef.current = announcements;
  }, [announcements]);

  useEffect(() => {
    let disposed = false;
    let unlistenOpen: (() => void) | null = null;
    let unlistenGroup: (() => void) | null = null;
    function applyOpenPayload(
      payload: GroupAnnouncementOpenPayload | null | undefined,
      options: { forceRefresh?: boolean } = {},
    ) {
      if (!payload?.groupId) {
        return;
      }
      const currentContext = contextRef.current;
      const sameContext =
        currentContext?.groupId === payload.groupId &&
        currentContext?.groupName === payload.groupName &&
        currentContext?.currentUserRole === payload.currentUserRole;
      const shouldRefresh =
        options.forceRefresh ||
        currentContext?.groupId !== payload.groupId ||
        loadedGroupIdRef.current !== payload.groupId;
      const canManageByRole = isGroupAnnouncementManager(payload.currentUserRole);
      contextRef.current = payload;
      if (!sameContext) {
        setContext(payload);
      }
      if (currentContext?.groupId && currentContext.groupId !== payload.groupId) {
        setAnnouncements([]);
        announcementsRef.current = [];
      }
      setCanManage(canManageByRole);
      if (shouldRefresh) {
        setEditor(null);
        setError(null);
        void refreshAnnouncements(payload.groupId, false, payload.currentUserRole);
      }
    }
    async function pullLatestOpenPayload() {
      const latestPayload = await invoke<GroupAnnouncementOpenPayload | null>(
        "get_group_announcement_open_payload",
      ).catch(() => null);
      if (!disposed) {
        applyOpenPayload(latestPayload);
      }
    }
    async function bind() {
      unlistenOpen = await listen<GroupAnnouncementOpenPayload>(
        GROUP_ANNOUNCEMENT_OPEN_EVENT,
        (event) => {
          if (disposed) {
            return;
          }
          applyOpenPayload(event.payload, { forceRefresh: true });
        },
      );
      await pullLatestOpenPayload();
      unlistenGroup = await listenForGroupEvents((event) => {
        const currentContext = contextRef.current;
        if (
          disposed ||
          event.event !== "group.announcement.updated" ||
          !currentContext?.groupId ||
          event.group?.id !== currentContext.groupId
        ) {
          return;
        }
        if (event.announcements) {
          setAnnouncements(event.announcements);
          announcementsRef.current = event.announcements;
          loadedGroupIdRef.current = currentContext.groupId;
          return;
        }
        void refreshAnnouncements(
          currentContext.groupId,
          true,
          currentContext.currentUserRole,
        );
      });
    }
    const handleWindowFocus = () => {
      void pullLatestOpenPayload();
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void pullLatestOpenPayload();
      }
    };
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void bind();
    return () => {
      disposed = true;
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unlistenOpen?.();
      unlistenGroup?.();
    };
  }, []);

  async function refreshAnnouncements(
    groupId: string,
    silent = false,
    currentUserRole?: string | null,
  ) {
    if (loadingGroupIdRef.current === groupId) {
      return;
    }
    loadingGroupIdRef.current = groupId;
    try {
      if (!silent) {
        setLoading(true);
      }
      setError(null);
      const response = await listChatGroupAnnouncements(groupId);
      setAnnouncements(response.announcements);
      loadedGroupIdRef.current = groupId;
      setCanManage(
        response.canManage ||
          response.announcements.some((announcement) => announcement.canManage) ||
          isGroupAnnouncementManager(currentUserRole),
      );
      setMaxCount(response.maxCount);
    } catch (err) {
      setError(friendlyError(String(err)));
    } finally {
      loadingGroupIdRef.current = null;
      setLoading(false);
    }
  }

  const openCreateEditor = () => {
    if (!canManageAnnouncements || announcements.length >= maxCount) {
      return;
    }
    setEditor({ mode: "create", content: "" });
    setError(null);
  };

  const openEditEditor = (announcement: ChatGroupAnnouncement) => {
    if (!canManageAnnouncements) {
      return;
    }
    setEditor({ mode: "edit", announcement, content: announcement.content });
    setError(null);
  };

  const saveEditor = async () => {
    if (!context || !editor || saving) {
      return;
    }
    const content = editor.content.trim();
    if (!content) {
      setError("群公告不能为空");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const response =
        editor.mode === "create"
          ? await createChatGroupAnnouncement({ groupId: context.groupId, content })
          : await updateChatGroupAnnouncement({
              groupId: context.groupId,
              announcementId: editor.announcement.id,
              content,
            });
      setAnnouncements(response.announcements);
      setCanManage(
        Boolean(response.announcement.canManage) ||
          isGroupAnnouncementManager(context.currentUserRole),
      );
      setEditor(null);
    } catch (err) {
      setError(friendlyError(String(err)));
    } finally {
      setSaving(false);
    }
  };

  const deleteAnnouncement = async (announcement: ChatGroupAnnouncement) => {
    if (!context || !canManageAnnouncements || deletingId !== null) {
      return;
    }
    const ok = window.confirm("确定删除这条群公告？");
    if (!ok) {
      return;
    }
    try {
      setDeletingId(announcement.id);
      setError(null);
      const response = await deleteChatGroupAnnouncement({
        groupId: context.groupId,
        announcementId: announcement.id,
      });
      setAnnouncements(response.announcements);
      setCanManage(
        response.canManage || isGroupAnnouncementManager(context.currentUserRole),
      );
      setMaxCount(response.maxCount);
    } catch (err) {
      setError(friendlyError(String(err)));
    } finally {
      setDeletingId(null);
    }
  };

  const updateEditorContent = (content: string) => {
    if (!editor) {
      return;
    }
    const nextContent = content.slice(0, ANNOUNCEMENT_MAX_LENGTH);
    setEditor(
      editor.mode === "create"
        ? { mode: "create", content: nextContent }
        : { ...editor, content: nextContent },
    );
  };

  const editorTitle =
    editor?.mode === "create" ? "发布新公告" : "编辑群公告";

  return (
    <main className="group-announcement-window">
      {editor ? (
        <section className="group-announcement-editor">
          <header className="group-announcement-editor-header">
            <h1>{editorTitle}</h1>
            <p>{context?.groupName || "群公告"}</p>
          </header>
          <textarea
            autoFocus
            value={editor.content}
            maxLength={ANNOUNCEMENT_MAX_LENGTH}
            placeholder="输入群公告内容"
            disabled={saving}
            onChange={(event) => updateEditorContent(event.target.value)}
          />
          <div className="group-announcement-editor-meta">
            <span>{editor.content.length}/{ANNOUNCEMENT_MAX_LENGTH}</span>
          </div>
          {error ? <p className="group-announcement-error">{error}</p> : null}
          <footer>
            <button type="button" disabled={saving} onClick={() => setEditor(null)}>
              取消
            </button>
            <button
              type="button"
              className="profile-primary-button"
              disabled={saving || !editor.content.trim()}
              onClick={() => void saveEditor()}
            >
              {saving ? "发布中..." : "发布"}
            </button>
          </footer>
        </section>
      ) : (
        <>
          <section className="group-announcement-header">
            <h1>{context?.groupName || "群公告"}</h1>
            {canManageAnnouncements ? (
              <button
                type="button"
                className="profile-primary-button"
                disabled={announcements.length >= maxCount}
                title={
                  announcements.length >= maxCount
                    ? `最多只能发布 ${maxCount} 条群公告`
                    : "发布新公告"
                }
                onClick={openCreateEditor}
              >
                发布新公告
              </button>
            ) : null}
          </section>
          {error ? <p className="group-announcement-error">{error}</p> : null}
          <section className="group-announcement-list">
            {loading ? <p className="group-announcement-empty">正在加载群公告...</p> : null}
            {!loading && sortedAnnouncements.length === 0 ? (
              <p className="group-announcement-empty">
                {canManageAnnouncements ? "暂无群公告，可发布新公告" : "暂无群公告"}
              </p>
            ) : null}
            {sortedAnnouncements.map((announcement) => (
              <article key={announcement.id} className="group-announcement-card">
                <header>
                  <span>
                    {announcement.updatedByProfile?.nickname ||
                      announcement.createdByProfile?.nickname ||
                      `用户${announcement.updatedByUserId}`}
                  </span>
                  <time>{formatAnnouncementTime(announcement.updatedAt || announcement.createdAt)}</time>
                  {canManageAnnouncements ? (
                    <span className="group-announcement-actions">
                      <button type="button" title="编辑" onClick={() => openEditEditor(announcement)}>
                        编辑
                      </button>
                      <button
                        type="button"
                        title="删除"
                        disabled={deletingId === announcement.id}
                        onClick={() => void deleteAnnouncement(announcement)}
                      >
                        {deletingId === announcement.id ? "删除中" : "删除"}
                      </button>
                    </span>
                  ) : null}
                </header>
                <p>{announcement.content}</p>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}

function isGroupAnnouncementManager(role?: string | null): boolean {
  return role === "owner" || role === "admin";
}

function compareAnnouncements(
  left: ChatGroupAnnouncement,
  right: ChatGroupAnnouncement,
): number {
  const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
  const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return right.id - left.id;
}

function formatAnnouncementTime(value?: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${date
    .getHours()
    .toString()
    .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function friendlyError(value: string): string {
  if (value.includes("Group announcement limit exceeded")) {
    return "最多只能发布 3 条群公告，请先删除旧公告";
  }
  if (value.includes("Only group owner or admin")) {
    return "只有群主或管理员可以管理群公告";
  }
  if (value.includes("Announcement content cannot be empty")) {
    return "群公告不能为空";
  }
  return value.replace(/^Error:\s*/, "");
}
