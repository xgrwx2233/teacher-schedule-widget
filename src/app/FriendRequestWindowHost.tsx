import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import {
  loadUserProfile,
  sendFriendRequest,
} from "../features/profile/profileRepository";
import type { UserProfile } from "../features/profile/types";
import {
  AUTH_STATE_CHANGED_EVENT,
  FRIEND_REQUEST_OPEN_EVENT,
  FRIEND_REQUEST_SENT_EVENT,
} from "../features/settings/windowEvents";

type FriendRequestOpenPayload = {
  userId?: number;
};

export function FriendRequestWindowHost() {
  const [userId, setUserId] = useState<number | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [message, setMessage] = useState("你好，我想添加你为好友");
  const [tip, setTip] = useState("");
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setUserId(null);
    setProfile(null);
    setMessage("你好，我想添加你为好友");
    setTip("");
    setBusy(false);
  };

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let unlistenAuth: (() => void) | null = null;
    async function bind() {
      unlisten = await listen<FriendRequestOpenPayload>(
        FRIEND_REQUEST_OPEN_EVENT,
        (event) => {
          if (!disposed && event.payload.userId) {
            setProfile(null);
            setTip("");
            setMessage("你好，我想添加你为好友");
            setUserId(event.payload.userId);
          }
        },
      );
      unlistenAuth = await listen(AUTH_STATE_CHANGED_EVENT, () => {
        if (!disposed) {
          reset();
        }
      });
    }
    void bind();
    return () => {
      disposed = true;
      unlisten?.();
      unlistenAuth?.();
    };
  }, []);

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
          setProfile(next);
        }
      } catch (error) {
        if (!cancelled) {
          setTip(String(error));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const submit = async () => {
    if (!profile) {
      return;
    }
    try {
      setBusy(true);
      const request = await sendFriendRequest(profile.userId, message.trim());
      await emit(FRIEND_REQUEST_SENT_EVENT, {
        userId: profile.userId,
        request,
      });
      setTip("好友申请已发送");
      window.setTimeout(() => {
        void getCurrentWindow().hide();
      }, 700);
    } catch (error) {
      setTip(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="friend-request-root">
      {profile ? (
        <section className="friend-request-panel">
          <span
            className={`profile-avatar is-large ${profile.avatarUrl ? "has-image" : ""}`}
            style={
              profile.avatarUrl
                ? { backgroundImage: `url(${profile.avatarUrl})` }
                : undefined
            }
          >
            {profile.avatarUrl ? "" : profile.nickname.slice(0, 1)}
          </span>
          <h1>{profile.nickname}</h1>
          <textarea
            value={message}
            maxLength={500}
            onChange={(event) => setMessage(event.currentTarget.value)}
          />
          <div className="friend-request-actions">
            <button type="button" onClick={() => void getCurrentWindow().hide()}>
              取消
            </button>
            <button
              type="button"
              className="profile-primary-button"
              disabled={busy}
              onClick={() => void submit()}
            >
              发送申请
            </button>
          </div>
          {tip ? <p className="profile-message">{tip}</p> : null}
        </section>
      ) : (
        <p className="profile-message">{tip || "请选择用户"}</p>
      )}
    </main>
  );
}
