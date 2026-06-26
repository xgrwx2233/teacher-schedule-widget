import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalAccountState } from "../features/account/types";
import { sendChatGroupJoinRequest } from "../features/chat/chatRepository";
import { searchProfiles } from "../features/profile/profileRepository";
import type {
  FriendRequest,
  GroupSearchResult,
  UserProfile,
} from "../features/profile/types";
import {
  AUTH_STATE_CHANGED_EVENT,
  CHAT_OPEN_CONVERSATION_EVENT,
  FRIEND_REQUEST_EVENT,
  FRIEND_REQUEST_SENT_EVENT,
} from "../features/settings/windowEvents";

type SearchScope = "all" | "users" | "groups";

export function ProfileSearchWindowHost() {
  const [keyword, setKeyword] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [groups, setGroups] = useState<GroupSearchResult[]>([]);
  const [joinDialogGroup, setJoinDialogGroup] = useState<GroupSearchResult | null>(null);
  const [joinMessage, setJoinMessage] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const accountKeyRef = useRef<string | null>(null);

  const resetSearchState = useCallback(() => {
    setKeyword("");
    setScope("all");
    setUsers([]);
    setGroups([]);
    setJoinDialogGroup(null);
    setJoinMessage("");
    setMessage("");
    setBusy(false);
    setJoinBusy(false);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let unlistenRealtime: (() => void) | null = null;
    async function bind() {
      unlisten = await listen<{
        userId?: number;
        request?: FriendRequest;
      }>(FRIEND_REQUEST_SENT_EVENT, (event) => {
        if (disposed || !event.payload.userId || !accountKeyRef.current) {
          return;
        }
        const targetUserId = event.payload.userId;
        setUsers((current) =>
          current.map((profile) =>
            profile.userId === targetUserId
              ? { ...profile, friendStatus: "pending" }
              : profile,
          ),
        );
        setMessage("好友申请已发送");
      });
      unlistenRealtime = await listen<{
        event?: string;
        payload?: { request?: FriendRequest };
      }>(FRIEND_REQUEST_EVENT, (event) => {
        if (disposed || !accountKeyRef.current) {
          return;
        }
        const request = event.payload.payload?.request;
        if (!request) {
          return;
        }
        setUsers((current) =>
          current.map((profile) => {
            if (
              profile.userId !== request.fromUserId &&
              profile.userId !== request.toUserId
            ) {
              return profile;
            }
            return {
              ...profile,
              friendStatus: friendStatusFromRealtimeEvent(
                event.payload.event,
                request,
                profile.userId,
              ),
            };
          }),
        );
      });
    }
    void bind();
    return () => {
      disposed = true;
      unlisten?.();
      unlistenRealtime?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenAuth: (() => void) | null = null;
    async function bind() {
      try {
        const state = await invoke<LocalAccountState>("load_local_account_state");
        if (!disposed) {
          accountKeyRef.current = profileSearchAccountKey(state);
        }
      } catch {
        if (!disposed) {
          accountKeyRef.current = null;
        }
      }
      unlistenAuth = await listen<LocalAccountState>(
        AUTH_STATE_CHANGED_EVENT,
        (event) => {
          if (disposed) {
            return;
          }
          const nextAccountKey = profileSearchAccountKey(event.payload);
          if (nextAccountKey !== accountKeyRef.current) {
            accountKeyRef.current = nextAccountKey;
            resetSearchState();
          }
        },
      );
    }
    void bind();
    return () => {
      disposed = true;
      unlistenAuth?.();
    };
  }, [resetSearchState]);

  const visibleUsers = useMemo(
    () => (scope === "groups" ? [] : users),
    [scope, users],
  );
  const visibleGroups = useMemo(
    () => (scope === "users" ? [] : groups),
    [scope, groups],
  );

  const runSearch = async () => {
    const value = keyword.trim();
    if (!value) {
      setUsers([]);
      setGroups([]);
      setMessage("");
      return;
    }
    const requestAccountKey = accountKeyRef.current;
    try {
      setBusy(true);
      const result = await searchProfiles(value, scope);
      if (requestAccountKey !== accountKeyRef.current) {
        return;
      }
      setUsers(result.users);
      setGroups(result.groups);
      setMessage(
        result.users.length > 0 || result.groups.length > 0
          ? ""
          : scope === "groups"
            ? "未找到相关群聊"
            : scope === "users"
              ? "未找到相关用户"
              : "未找到相关用户或群聊",
      );
    } catch (error) {
      if (requestAccountKey === accountKeyRef.current) {
        setMessage(String(error));
      }
    } finally {
      if (requestAccountKey === accountKeyRef.current) {
        setBusy(false);
      }
    }
  };

  const openProfile = (userId: number) => {
    void invoke("open_friend_profile_window", { userId });
  };

  const addFriend = (profile: UserProfile) => {
    void invoke("open_friend_request_window", { userId: profile.userId });
  };

  const openGroupConversation = async (group: GroupSearchResult) => {
    try {
      setMessage("");
      await invoke("open_chat_window");
      await emit(CHAT_OPEN_CONVERSATION_EVENT, {
        conversationId: group.conversationId,
      });
    } catch (error) {
      setMessage(String(error));
    }
  };

  const submitJoinGroup = async () => {
    if (!joinDialogGroup || joinBusy) {
      return;
    }
    try {
      setJoinBusy(true);
      setMessage("");
      await sendChatGroupJoinRequest({
        groupId: joinDialogGroup.id,
        message: joinMessage.trim(),
      });
      setGroups((current) =>
        current.map((group) =>
          group.id === joinDialogGroup.id
            ? { ...group, relationStatus: "pending" }
            : group,
        ),
      );
      setJoinDialogGroup(null);
      setJoinMessage("");
      setMessage("加群申请已发送，等待群主或管理员处理");
    } catch (error) {
      setMessage(friendlyGroupSearchError(String(error)));
    } finally {
      setJoinBusy(false);
    }
  };

  return (
    <main className="profile-search-root">
      <section className="profile-search-toolbar">
        <label className="profile-search-input">
          <span>⌕</span>
          <input
            value={keyword}
            autoFocus
            placeholder="手机号 / 昵称 / 班级号 / 群号"
            onChange={(event) => setKeyword(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void runSearch();
              }
            }}
          />
        </label>
        <button type="button" disabled={busy} onClick={() => void runSearch()}>
          搜索
        </button>
      </section>
      <nav className="profile-search-tabs">
        {[
          ["all", "全部"],
          ["users", "用户"],
          ["groups", "群聊"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={scope === value ? "is-active" : ""}
            onClick={() => setScope(value as SearchScope)}
          >
            {label}
          </button>
        ))}
      </nav>
      <section className="profile-search-results">
        {visibleUsers.length > 0 ? (
          visibleUsers.map((profile) => (
            <button
              key={profile.userId}
              type="button"
              className="profile-result-card"
              onClick={() => openProfile(profile.userId)}
            >
              <ProfileResultAvatar profile={profile} />
              <span className="profile-result-main">
                <strong>
                  {profile.nickname}
                  {profile.accountType === "class" ? (
                    <SearchTypeBadge label="班级账号" />
                  ) : null}
                </strong>
                <span>{profile.bio || "暂无简介"}</span>
              </span>
              <FriendActionButton
                profile={profile}
                onAdd={() => void addFriend(profile)}
              />
            </button>
          ))
        ) : null}
        {visibleGroups.length > 0
          ? visibleGroups.map((group) => (
              <GroupResultCard
                key={group.id}
                group={group}
                onJoin={() => {
                  setJoinDialogGroup(group);
                  setJoinMessage("");
                  setMessage("");
                }}
                onOpen={() => void openGroupConversation(group)}
              />
            ))
          : null}
      </section>
      {message ? <p className="profile-search-message">{message}</p> : null}
      {joinDialogGroup ? (
        <JoinGroupDialog
          group={joinDialogGroup}
          message={joinMessage}
          busy={joinBusy}
          onMessageChange={setJoinMessage}
          onClose={() => {
            if (joinBusy) {
              return;
            }
            setJoinDialogGroup(null);
            setJoinMessage("");
          }}
          onSubmit={() => void submitJoinGroup()}
        />
      ) : null}
    </main>
  );
}

function FriendActionButton({
  profile,
  onAdd,
}: {
  profile: UserProfile;
  onAdd: () => void;
}) {
  const status = profile.friendStatus;
  if (status === "self") {
    return <span className="profile-result-status">自己</span>;
  }
  if (status === "friend") {
    return <span className="profile-result-status">已添加</span>;
  }
  if (status === "pending") {
    return <span className="profile-result-status">等待验证</span>;
  }
  return (
    <button
      type="button"
      className="profile-result-action"
      onClick={(event) => {
        event.stopPropagation();
        onAdd();
      }}
    >
      {status === "rejected" ? "重新申请" : "添加"}
    </button>
  );
}

function ProfileResultAvatar({ profile }: { profile: UserProfile }) {
  return (
    <span
      className={`profile-avatar is-small ${profile.avatarUrl ? "has-image" : ""}`}
      style={
        profile.avatarUrl ? { backgroundImage: `url(${profile.avatarUrl})` } : undefined
      }
    >
      {profile.avatarUrl ? "" : profile.nickname.slice(0, 1)}
    </span>
  );
}

function GroupResultCard({
  group,
  onJoin,
  onOpen,
}: {
  group: GroupSearchResult;
  onJoin: () => void;
  onOpen: () => void;
}) {
  return (
    <article className="profile-result-card group-result-card">
      <GroupResultAvatar group={group} />
      <span className="profile-result-main">
        <strong>
          {group.name}
          {group.groupType === "class" ? <SearchTypeBadge label="班级群" /> : null}
        </strong>
        <span>{group.description || group.announcement || "暂无群简介"}</span>
        <em>
          {group.groupNo ? `群号 ${group.groupNo} · ` : ""}
          {group.memberCount}/{group.memberLimit || 500}
        </em>
      </span>
      <GroupActionButton group={group} onJoin={onJoin} onOpen={onOpen} />
    </article>
  );
}

function GroupActionButton({
  group,
  onJoin,
  onOpen,
}: {
  group: GroupSearchResult;
  onJoin: () => void;
  onOpen: () => void;
}) {
  if (group.relationStatus === "joined") {
    return (
      <button type="button" className="profile-result-action" onClick={onOpen}>
        发起聊天
      </button>
    );
  }
  if (group.relationStatus === "pending") {
    return <span className="profile-result-status">等待审核</span>;
  }
  return (
    <button type="button" className="profile-result-action" onClick={onJoin}>
      加入
    </button>
  );
}

function GroupResultAvatar({ group }: { group: GroupSearchResult }) {
  return (
    <span
      className={`profile-group-avatar ${group.avatarUrl ? "has-image" : ""}`}
      style={
        group.avatarUrl ? { backgroundImage: `url(${group.avatarUrl})` } : undefined
      }
    >
      {group.avatarUrl ? "" : group.name.slice(0, 1)}
    </span>
  );
}

function SearchTypeBadge({ label }: { label: string }) {
  return <i className="class-type-badge profile-search-type-badge">{label}</i>;
}

function JoinGroupDialog({
  group,
  message,
  busy,
  onMessageChange,
  onClose,
  onSubmit,
}: {
  group: GroupSearchResult;
  message: string;
  busy: boolean;
  onMessageChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="profile-search-dialog-backdrop" onClick={onClose}>
      <section
        className="profile-search-join-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <GroupResultAvatar group={group} />
          <div>
            <h2>{group.name}</h2>
            <p>
              {group.memberCount}/{group.memberLimit || 500} 人
            </p>
          </div>
        </header>
        <label>
          <span>验证信息</span>
          <textarea
            value={message}
            maxLength={60}
            autoFocus
            placeholder="请输入验证信息"
            onChange={(event) => onMessageChange(event.currentTarget.value)}
          />
          <em>{message.length}/60</em>
        </label>
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="profile-primary-button"
            disabled={busy}
            onClick={onSubmit}
          >
            {busy ? "发送中..." : "发送"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function profileSearchAccountKey(state: LocalAccountState | null): string | null {
  if (!state?.loggedIn) {
    return null;
  }
  const cloudUserId = state.user?.cloudUserId?.trim();
  if (cloudUserId) {
    return `cloud:${cloudUserId}`;
  }
  return state.ownerUserId ? `local:${state.ownerUserId}` : null;
}

function friendStatusFromRealtimeEvent(
  eventName: string | undefined,
  request: FriendRequest,
  profileUserId: number,
): UserProfile["friendStatus"] {
  if (eventName === "friend.request.accepted") {
    return "friend";
  }
  if (eventName === "friend.request.rejected") {
    return request.fromUserId === profileUserId ? "rejected" : "none";
  }
  return "pending";
}

function friendlyGroupSearchError(error: string): string {
  if (error.includes("Already in group")) {
    return "你已在该群聊中";
  }
  if (error.includes("Group member limit exceeded")) {
    return "群成员已满";
  }
  if (error.includes("Group not found")) {
    return "群聊不存在或已解散";
  }
  if (error.includes("Not authenticated")) {
    return "登录状态已失效，请重新登录";
  }
  return error;
}
