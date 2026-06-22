import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import { FriendProfileView } from "../components/Profile/ProfileViews";
import { createDirectConversation } from "../features/chat/chatRepository";
import type { LocalAccountState } from "../features/account/types";
import type { UserProfile } from "../features/profile/types";
import {
  AUTH_STATE_CHANGED_EVENT,
  CHAT_OPEN_CONVERSATION_EVENT,
  FRIEND_PROFILE_OPEN_EVENT,
} from "../features/settings/windowEvents";

type FriendProfileOpenPayload = {
  userId?: number;
};

export function FriendProfileWindowHost() {
  const [eventUserId, setEventUserId] = useState<number | null>(null);
  const queryUserId = useMemo(() => {
    const value =
      new URLSearchParams(window.location.search).get("userId") ||
      new URLSearchParams(window.location.hash.replace(/^#/, "")).get("userId");
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let unlistenAuth: (() => void) | null = null;
    async function bind() {
      unlisten = await listen<FriendProfileOpenPayload>(
        FRIEND_PROFILE_OPEN_EVENT,
        (event) => {
          if (!disposed && event.payload.userId) {
            setEventUserId(event.payload.userId);
          }
        },
      );
      unlistenAuth = await listen<LocalAccountState>(
        AUTH_STATE_CHANGED_EVENT,
        () => {
          if (!disposed) {
            setEventUserId(null);
          }
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

  const sendMessage = async (profile: UserProfile) => {
    const conversation = await createDirectConversation(profile.userId);
    await invoke("open_chat_window");
    await emit(CHAT_OPEN_CONVERSATION_EVENT, {
      userId: profile.userId,
      conversationId: conversation.id,
    });
  };

  return (
    <FriendProfileView
      userId={eventUserId ?? queryUserId}
      onSendMessage={(profile) => void sendMessage(profile)}
    />
  );
}
