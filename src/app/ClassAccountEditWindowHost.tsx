import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState } from "react";
import type { LocalAccountState } from "../features/account/types";
import {
  applyClassAccount,
  uploadProfileAvatarBytes,
} from "../features/profile/profileRepository";
import {
  CHAT_OPEN_CONVERSATION_EVENT,
  FRIEND_REQUEST_SENT_EVENT,
} from "../features/settings/windowEvents";

export function ClassAccountEditWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [nickname, setNickname] = useState("");
  const [bio, setBio] = useState("");
  const [linkedPhone, setLinkedPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarObjectKey, setAvatarObjectKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    async function loadDefaultPhone() {
      try {
        const state = await invoke<LocalAccountState>("load_local_account_state");
        if (!disposed) {
          setLinkedPhone(state.user?.phone?.startsWith("class:") ? "" : state.user?.phone ?? "");
        }
      } catch {
        if (!disposed) {
          setLinkedPhone("");
        }
      }
    }
    void loadDefaultPhone();
    return () => {
      disposed = true;
    };
  }, []);

  const uploadAvatar = async (file: File | null) => {
    if (!file) return;
    try {
      setBusy(true);
      const uploaded = await uploadProfileAvatarBytes({
        filename: file.name || "class-avatar.png",
        contentType: file.type || "image/png",
        bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
      });
      setAvatarUrl(uploaded.url ?? "");
      setAvatarObjectKey(uploaded.objectKey);
      setMessage("头像已上传");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const name = nickname.trim();
    const phone = linkedPhone.trim();
    if (!name) {
      setMessage("班级昵称不能为空");
      return;
    }
    if (!phone) {
      setMessage("关联手机号不能为空");
      return;
    }
    try {
      setBusy(true);
      setMessage("");
      const result = await applyClassAccount({
        nickname: name,
        avatarUrl: avatarObjectKey ? null : avatarUrl || null,
        avatarObjectKey: avatarObjectKey || null,
        bio: bio.trim() || null,
        linkedPhone: phone,
      });
      await emit(FRIEND_REQUEST_SENT_EVENT, {
        profile: result.profile,
      });
      await invoke("open_chat_window");
      await emit(CHAT_OPEN_CONVERSATION_EVENT, {
        conversationId: result.conversation.id,
      });
      setMessage(`申请成功，班级号 ${result.classAccount.classNo}`);
      window.setTimeout(() => {
        void currentWindow.hide();
      }, 600);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="profile-window-root">
      <section className="profile-edit-panel class-account-edit-panel">
        <header className="class-account-edit-header">
          <h1>申请班级账号</h1>
          <p>班级账号会作为特殊联系人加入好友列表，并自动创建一对一会话。</p>
        </header>
        <label className="profile-avatar-editor" title="更换班级头像">
          <span className={`profile-avatar is-large ${avatarUrl ? "has-image" : ""}`}>
            {avatarUrl ? <img src={avatarUrl} alt="" /> : nickname.slice(0, 1) || "班"}
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => void uploadAvatar(event.currentTarget.files?.[0] ?? null)}
          />
          <span className="profile-avatar-edit-icon">换</span>
        </label>
        <label className="profile-field">
          <span>班级昵称</span>
          <input
            value={nickname}
            maxLength={60}
            placeholder="例如：三年级一班"
            onChange={(event) => setNickname(event.currentTarget.value)}
          />
        </label>
        <label className="profile-field">
          <span>班级简介</span>
          <textarea
            value={bio}
            maxLength={500}
            placeholder="可填写班级说明、年级、校区等"
            onChange={(event) => setBio(event.currentTarget.value)}
          />
        </label>
        <label className="profile-field">
          <span>关联手机号</span>
          <input
            value={linkedPhone}
            maxLength={20}
            inputMode="tel"
            placeholder="用于班级号验证码登录"
            onChange={(event) => setLinkedPhone(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          className="profile-primary-button"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? "提交中..." : "确定申请"}
        </button>
        {message ? <p className="profile-message">{message}</p> : null}
      </section>
    </main>
  );
}
