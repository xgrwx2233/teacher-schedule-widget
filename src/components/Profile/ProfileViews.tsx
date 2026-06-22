import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalAccountState } from "../../features/account/types";
import {
  cacheProfileAvatar,
  loadMyProfile,
  loadUserProfile,
  profileInitial,
  saveMyProfile,
  uploadProfileAvatarBytes,
} from "../../features/profile/profileRepository";
import type { FriendRequest, UserProfile } from "../../features/profile/types";
import {
  AUTH_STATE_CHANGED_EVENT,
  FRIEND_REQUEST_EVENT,
  PROFILE_UPDATED_EVENT,
} from "../../features/settings/windowEvents";

const profileAvatarSessionCache = new Map<string, string>();

export function ProfileEditView() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [nickname, setNickname] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarObjectKey, setAvatarObjectKey] = useState("");
  const [bio, setBio] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const applyProfile = useCallback((next: UserProfile) => {
  const cachedAvatarUrl = next.avatarUrl || next.avatarObjectKey
      ? profileAvatarSessionCache.get(profileAvatarCacheKey(next))
      : null;
    const displayProfile = cachedAvatarUrl
      ? { ...next, avatarUrl: cachedAvatarUrl }
      : next;
    setProfile((current) =>
      sameProfile(current, displayProfile) ? current : displayProfile,
    );
    setNickname(next.nickname);
    setAvatarUrl(displayProfile.avatarUrl ?? "");
    setAvatarObjectKey(next.avatarObjectKey ?? "");
    setBio(next.bio ?? "");
    void cacheFriendProfileAvatar(next, (localUrl) => {
      setProfile((current) => {
        if (!current || current.userId !== next.userId) {
          return current;
        }
        const updated = { ...current, avatarUrl: localUrl };
        return sameProfile(current, updated) ? current : updated;
      });
      setAvatarUrl(localUrl);
    });
  }, []);

  const resetProfile = useCallback(() => {
    setProfile(null);
    setNickname("");
    setAvatarUrl("");
    setAvatarObjectKey("");
    setBio("");
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const next = await loadMyProfile();
      applyProfile(next);
      setMessage("");
    } catch (error) {
      resetProfile();
      setMessage(String(error));
    }
  }, [applyProfile, resetProfile]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    let disposed = false;
    let unlistenAuth: (() => void) | null = null;
    let unlistenProfile: (() => void) | null = null;
    async function bind() {
      unlistenAuth = await listen(AUTH_STATE_CHANGED_EVENT, () => {
        if (!disposed) {
          void loadProfile();
        }
      });
      unlistenProfile = await listen<{ profile?: UserProfile }>(
        PROFILE_UPDATED_EVENT,
        (event) => {
          const next = event.payload.profile;
          if (!disposed && next?.friendStatus === "self") {
            applyProfile(next);
          }
        },
      );
    }
    void bind();
    return () => {
      disposed = true;
      unlistenAuth?.();
      unlistenProfile?.();
    };
  }, [applyProfile, loadProfile]);

  const save = async () => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      setMessage("昵称不能为空");
      return;
    }
    try {
      setBusy(true);
      const next = await saveMyProfile({
        nickname: trimmed,
        avatarUrl: avatarObjectKey ? null : avatarUrl.trim() || null,
        avatarObjectKey: avatarObjectKey || null,
        bio: bio.trim() || null,
      });
      applyProfile(next);
      await emit(PROFILE_UPDATED_EVENT, { profile: next });
      setMessage("已保存");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const uploadAvatar = async (file: File | null) => {
    if (!file) {
      return;
    }
    try {
      setBusy(true);
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const uploaded = await uploadProfileAvatarBytes({
        filename: file.name,
        contentType: file.type,
        bytes,
      });
      if (!uploaded.url) {
        setMessage("头像已上传，但未返回访问地址");
        return;
      }
      setAvatarUrl(uploaded.url);
      setAvatarObjectKey(uploaded.objectKey);
      setMessage("头像已上传");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="profile-window-root">
      <section className="profile-edit-panel">
        <label className="profile-avatar-editor" title="更换头像">
          <ProfileAvatar
            profile={
              profile
                ? { ...profile, avatarUrl: avatarUrl || profile.avatarUrl }
                : profile
            }
            size="large"
          />
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) =>
              void uploadAvatar(event.currentTarget.files?.[0] ?? null)
            }
          />
          <span className="profile-avatar-edit-icon">✎</span>
        </label>
        <label className="profile-field">
          <span>昵称</span>
          <input
            value={nickname}
            maxLength={60}
            onChange={(event) => setNickname(event.currentTarget.value)}
          />
        </label>
        <label className="profile-field">
          <span>简介</span>
          <textarea
            value={bio}
            maxLength={500}
            onChange={(event) => setBio(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          className="profile-primary-button"
          disabled={busy}
          onClick={() => void save()}
        >
          保存
        </button>
        {message ? <p className="profile-message">{message}</p> : null}
      </section>
    </main>
  );
}

export function FriendProfileView({
  userId,
  initialProfile,
  embedded = false,
  onSendMessage,
}: {
  userId?: number | null;
  initialProfile?: UserProfile | null;
  embedded?: boolean;
  onSendMessage?: (profile: UserProfile) => void;
}) {
  const [profile, setProfile] = useState<UserProfile | null>(
    initialProfile ?? null,
  );
  const [message, setMessage] = useState("");

  const applyProfile = useCallback((next: UserProfile) => {
    const cachedAvatarUrl = next.avatarUrl
      ? profileAvatarSessionCache.get(profileAvatarCacheKey(next))
      : null;
    const displayProfile = cachedAvatarUrl
      ? { ...next, avatarUrl: cachedAvatarUrl }
      : next;
    setProfile((current) =>
      sameProfile(current, displayProfile) ? current : displayProfile,
    );
    void cacheFriendProfileAvatar(next, (localUrl) => {
      setProfile((current) => {
        if (!current || current.userId !== next.userId) {
          return current;
        }
        return sameProfile(current, { ...current, avatarUrl: localUrl })
          ? current
          : { ...current, avatarUrl: localUrl };
      });
    });
  }, []);

  useEffect(() => {
    if (initialProfile && initialProfile.userId === userId) {
      applyProfile(initialProfile);
      setMessage("");
    }
  }, [applyProfile, initialProfile, userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }
    const targetUserId = userId;
    let cancelled = false;
    async function load() {
      try {
        const next = await loadUserProfile(targetUserId);
        if (!cancelled) {
          applyProfile(next);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(String(error));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [applyProfile, userId]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let unlistenFriend: (() => void) | null = null;
    async function bind() {
      unlisten = await listen<{ profile?: UserProfile }>(
        PROFILE_UPDATED_EVENT,
        (event) => {
          const next = event.payload.profile;
          if (!disposed && next && next.userId === userId) {
            applyProfile(next);
          }
        },
      );
      unlistenFriend = await listen<{
        event?: string;
        payload?: { request?: FriendRequest };
      }>(FRIEND_REQUEST_EVENT, (event) => {
        const request = event.payload.payload?.request;
        if (
          disposed ||
          !request ||
          !userId ||
          (request.fromUserId !== userId && request.toUserId !== userId)
        ) {
          return;
        }
        setProfile((current) => {
          if (!current || current.userId !== userId) {
            return current;
          }
          const friendStatus = profileFriendStatusFromRealtimeEvent(
            event.payload.event,
            request,
            current.userId,
          );
          return current.friendStatus === friendStatus
            ? current
            : { ...current, friendStatus };
        });
      });
    }
    void bind();
    return () => {
      disposed = true;
      unlisten?.();
      unlistenFriend?.();
    };
  }, [applyProfile, userId]);

  const canSendMessage = profile?.friendStatus === "friend";
  const className = embedded
    ? "profile-window-root is-embedded"
    : "profile-window-root";

  return (
    <main className={className}>
      <section className="friend-profile-card">
        {profile ? (
          <>
            <ProfileAvatar profile={profile} size="large" />
            <h1>{profile.nickname}</h1>
            <p className="profile-presence">
              <span className={profile.online ? "is-online" : ""} />
              {profile.online ? "在线" : "离线"}
            </p>
            <p className="profile-bio">{profile.bio || "暂无简介"}</p>
            {canSendMessage ? (
              <button
                type="button"
                className="profile-primary-button"
                onClick={() => onSendMessage?.(profile)}
              >
                发消息
              </button>
            ) : null}
          </>
        ) : (
          <p className="profile-message">{message || "请选择联系人"}</p>
        )}
      </section>
    </main>
  );
}

function ProfileAvatar({
  profile,
  size,
}: {
  profile: UserProfile | null;
  size: "large" | "small";
}) {
  const style = useMemo(
    () =>
      profile?.avatarUrl
        ? { backgroundImage: `url(${profile.avatarUrl})` }
        : undefined,
    [profile?.avatarUrl],
  );
  return (
    <span
      className={`profile-avatar is-${size} ${profile?.avatarUrl ? "has-image" : ""}`}
      style={style}
    >
      {profile?.avatarUrl ? "" : profileInitial(profile)}
    </span>
  );
}

async function cacheFriendProfileAvatar(
  profile: UserProfile,
  onCached: (localUrl: string) => void,
) {
  if (!profile.avatarUrl && !profile.avatarObjectKey) {
    return;
  }
  const cacheKey = profileAvatarCacheKey(profile);
  const cached = profileAvatarSessionCache.get(cacheKey);
  if (cached) {
    onCached(cached);
    return;
  }
  try {
    const state = await invoke<LocalAccountState>("load_local_account_state");
    const accountKey = profileAccountKey(state);
    if (!accountKey) {
      return;
    }
    const localUrl = await cacheProfileAvatar({
      accountKey,
      avatarKey: profile.avatarObjectKey || String(profile.userId),
      avatarUrl: profile.avatarUrl || profile.avatarObjectKey || "",
    });
    profileAvatarSessionCache.set(cacheKey, localUrl);
    onCached(localUrl);
  } catch {
    // Avatar cache failure should not block profile rendering.
  }
}

function profileAvatarCacheKey(profile: UserProfile): string {
  return profile.avatarObjectKey || profile.avatarUrl || `user:${profile.userId}`;
}

function profileAccountKey(state: LocalAccountState | null): string | null {
  if (!state?.loggedIn) {
    return null;
  }
  const cloudUserId = state.user?.cloudUserId?.trim();
  if (cloudUserId) {
    return `cloud:${cloudUserId}`;
  }
  return state.ownerUserId ? `local:${state.ownerUserId}` : null;
}

function profileFriendStatusFromRealtimeEvent(
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

function sameProfile(
  left: UserProfile | null | undefined,
  right: UserProfile | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.userId === right.userId &&
    left.nickname === right.nickname &&
    (left.avatarObjectKey || "") === (right.avatarObjectKey || "") &&
    (left.avatarUrl || "") === (right.avatarUrl || "") &&
    left.bio === right.bio &&
    left.online === right.online &&
    left.friendStatus === right.friendStatus &&
    left.updatedAt === right.updatedAt
  );
}
