import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CHAT_GROUP_EVENT, FRIEND_REQUEST_EVENT } from "../settings/windowEvents";
import type {
  ChatConversation,
  ChatGroup,
  ChatGroupAnnouncement,
  ChatGroupJoinRequest,
  ChatGroupMember,
  ChatFileDownloadResult,
  ChatMessage,
  ChatMessageKind,
  ConversationKind,
  UploadedChatFile,
} from "./types";
import type { FriendRequest } from "../profile/types";

type ApiConversation = {
  id: string;
  type: string;
  title: string;
  peerUserId?: number | null;
  currentUserId?: number | null;
  groupId?: string | null;
  groupMemberCount?: number | null;
  groupAvatarUrl?: string | null;
  deviceId?: string | null;
  lastMessagePreview?: string | null;
  lastMessageAt?: string | null;
  unreadCount?: number;
  pinned?: boolean;
  muted?: boolean;
  archived?: boolean;
  serverSeq?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type ApiMessage = {
  id: string;
  conversationId: string;
  senderId: number;
  messageType: string;
  content: string;
  contentJson?: Record<string, unknown> | null;
  fileObjectId?: string | null;
  clientMsgId: string;
  serverSeq: number;
  conversationSeq: number;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  revokedAt?: string | null;
};

export type FriendRealtimeEvent = {
  event:
    | "friend.request.created"
    | "friend.request.accepted"
    | "friend.request.rejected";
  request: FriendRequest;
};

export type ChatMessageDeletedEvent = {
  messageId: string;
  conversationId: string;
  conversationSeq?: number | null;
  deletedAt?: string | null;
};

export type ChatGroupRealtimeEvent = {
  event:
    | "group.created"
    | "group.updated"
    | "group.announcement.updated"
    | "group.member.added"
    | "group.member.removed"
    | "group.member.role_changed"
    | "group.join_request.created"
    | "group.join_request.handled"
    | "group.dissolved";
  group?: ChatGroup | null;
  conversation?: ChatConversation | null;
  request?: ChatGroupJoinRequest | null;
  announcements?: ChatGroupAnnouncement[] | null;
};

type GroupResponse = {
  group: ChatGroup;
  conversation: ApiConversation;
};

export async function loadChatConversations(): Promise<ChatConversation[]> {
  const response = await invoke<{ conversations: ApiConversation[] }>(
    "list_chat_conversations",
  );
  return response.conversations.map(mapConversation);
}

export async function loadChatMessages(
  conversationId: string,
  options: {
    afterSeq?: number;
    beforeSeq?: number;
    limit?: number;
  } = {},
): Promise<ChatMessage[]> {
  const response = await invoke<{ messages: ApiMessage[] }>("list_chat_messages", {
    conversationId,
    afterSeq: options.afterSeq ?? 0,
    beforeSeq: options.beforeSeq ?? 0,
    limit: options.limit ?? 50,
  });
  const accountState = await invoke<{ user?: { cloudUserId?: string | null } | null }>(
    "load_local_account_state",
  );
  const currentUserId = Number(accountState.user?.cloudUserId);
  return response.messages.map((message) =>
    mapMessage(
      message,
      Number.isInteger(currentUserId) && message.senderId === currentUserId
        ? "outgoing"
        : "incoming",
    ),
  );
}

export async function loadChatHistoryMessages(
  conversationId: string,
  options: {
    type?: "all" | "file" | "media" | "image" | "video" | "sticker" | "text";
    query?: string;
    afterSeq?: number;
    beforeSeq?: number;
    aroundSeq?: number;
    limit?: number;
    dateFrom?: string;
    dateTo?: string;
  } = {},
): Promise<ChatMessage[]> {
  const response = await invoke<{ messages: ApiMessage[] }>(
    "search_chat_history_messages",
    {
      conversationId,
      historyType: options.type ?? "all",
      query: options.query ?? "",
      afterSeq: options.afterSeq ?? 0,
      beforeSeq: options.beforeSeq ?? 0,
      aroundSeq: options.aroundSeq ?? 0,
      limit: options.limit ?? 80,
      dateFrom: options.dateFrom ?? null,
      dateTo: options.dateTo ?? null,
    },
  );
  const accountState = await invoke<{ user?: { cloudUserId?: string | null } | null }>(
    "load_local_account_state",
  );
  const currentUserId = Number(accountState.user?.cloudUserId);
  return response.messages.map((message) =>
    mapMessage(
      message,
      Number.isInteger(currentUserId) && message.senderId === currentUserId
        ? "outgoing"
        : "incoming",
    ),
  );
}

export async function postChatMessage(
  conversationId: string,
  content: string,
): Promise<ChatMessage> {
  return postTypedChatMessage({
    conversationId,
    content,
    messageType: "text",
  });
}

export async function postTypedChatMessage(input: {
  conversationId: string;
  content: string;
  messageType: ChatMessageKind;
  contentJson?: Record<string, unknown> | null;
  fileObjectId?: string | null;
}): Promise<ChatMessage> {
  const response = await invoke<{ message: ApiMessage }>("send_chat_message", {
    conversationId: input.conversationId,
    clientMsgId: `desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    messageType: input.messageType,
    content: input.content,
    contentJson: input.contentJson ?? null,
    fileObjectId: input.fileObjectId ?? null,
  });
  return mapMessage(response.message, "outgoing");
}

export async function uploadChatFileBytes(input: {
  filename: string;
  contentType?: string | null;
  bytes: number[];
  fileType: "image" | "file" | "sticker";
}): Promise<UploadedChatFile> {
  const response = await invoke<{ file: UploadedChatFile }>("upload_chat_file_bytes", {
    filename: input.filename,
    contentType: input.contentType ?? null,
    bytes: input.bytes,
    fileType: input.fileType,
  });
  return response.file;
}

export async function reuploadCachedChatFile(input: {
  fileObjectId: string;
  fileName: string;
  contentType?: string | null;
  fileType: "image" | "file" | "sticker";
}): Promise<UploadedChatFile> {
  const response = await invoke<{ file: UploadedChatFile }>("reupload_cached_chat_file", {
    fileObjectId: input.fileObjectId,
    fileName: input.fileName,
    contentType: input.contentType ?? null,
    fileType: input.fileType,
  });
  return response.file;
}

export async function getChatFileSignedUrl(fileObjectId: string): Promise<string> {
  const response = await invoke<{ url: string }>("get_chat_file_signed_url", {
    fileObjectId,
  });
  return response.url;
}

export async function downloadChatFile(
  fileObjectId: string,
  fileName: string,
): Promise<ChatFileDownloadResult> {
  return invoke<ChatFileDownloadResult>("download_chat_file", {
    fileObjectId,
    fileName,
  });
}

export async function cacheChatFile(
  fileObjectId: string,
  fileName: string,
): Promise<string> {
  const response = await invoke<{ path: string }>("cache_chat_file", {
    fileObjectId,
    fileName,
  });
  return convertFileSrc(response.path);
}

export async function openCachedChatFile(
  fileObjectId: string,
  fileName: string,
): Promise<string> {
  const response = await invoke<{ path: string }>("open_cached_chat_file", {
    fileObjectId,
    fileName,
  });
  return response.path;
}

export async function revokeChatMessage(messageId: string): Promise<ChatMessage> {
  const response = await invoke<{ message: ApiMessage }>("revoke_chat_message", {
    messageId,
  });
  return mapMessage(response.message, "outgoing");
}

export async function deleteChatMessageForMe(
  messageId: string,
): Promise<ChatMessageDeletedEvent> {
  return invoke<ChatMessageDeletedEvent>("delete_chat_message_for_me", {
    messageId,
  });
}

export async function createDirectConversation(
  peerUserId: number,
): Promise<ChatConversation> {
  const response = await invoke<{ conversation: ApiConversation }>(
    "create_direct_chat_conversation",
    { peerUserId },
  );
  return mapConversation(response.conversation);
}

export async function createChatGroup(input: {
  name?: string | null;
  memberUserIds: number[];
}): Promise<{ group: ChatGroup; conversation: ChatConversation }> {
  const response = await invoke<GroupResponse>("create_chat_group", {
    name: input.name ?? null,
    memberUserIds: input.memberUserIds,
  });
  return {
    group: response.group,
    conversation: mapConversation(response.conversation),
  };
}

export async function loadChatGroup(
  groupId: string,
): Promise<{ group: ChatGroup; conversation: ChatConversation }> {
  const response = await invoke<GroupResponse>("load_chat_group", { groupId });
  return {
    group: response.group,
    conversation: mapConversation(response.conversation),
  };
}

export async function updateChatGroup(input: {
  groupId: string;
  name?: string | null;
  avatarUrl?: string | null;
  avatarObjectKey?: string | null;
  description?: string | null;
  announcement?: string | null;
}): Promise<{ group: ChatGroup; conversation: ChatConversation }> {
  const response = await invoke<GroupResponse>("update_chat_group", {
    groupId: input.groupId,
    name: input.name ?? null,
    avatarUrl: input.avatarUrl ?? null,
    avatarObjectKey: input.avatarObjectKey ?? null,
    description: input.description ?? null,
    announcement: input.announcement ?? null,
  });
  return {
    group: response.group,
    conversation: mapConversation(response.conversation),
  };
}

export async function listChatGroupAnnouncements(
  groupId: string,
): Promise<{
  announcements: ChatGroupAnnouncement[];
  canManage: boolean;
  maxCount: number;
}> {
  return invoke<{
    announcements: ChatGroupAnnouncement[];
    canManage: boolean;
    maxCount: number;
  }>("list_chat_group_announcements", { groupId });
}

export async function createChatGroupAnnouncement(input: {
  groupId: string;
  content: string;
}): Promise<{
  announcement: ChatGroupAnnouncement;
  announcements: ChatGroupAnnouncement[];
  group: ChatGroup;
  conversation: ChatConversation;
}> {
  const response = await invoke<{
    announcement: ChatGroupAnnouncement;
    announcements: ChatGroupAnnouncement[];
    group: ChatGroup;
    conversation: ApiConversation;
  }>("create_chat_group_announcement", input);
  return {
    announcement: response.announcement,
    announcements: response.announcements,
    group: response.group,
    conversation: mapConversation(response.conversation),
  };
}

export async function updateChatGroupAnnouncement(input: {
  groupId: string;
  announcementId: number;
  content: string;
}): Promise<{
  announcement: ChatGroupAnnouncement;
  announcements: ChatGroupAnnouncement[];
  group: ChatGroup;
  conversation: ChatConversation;
}> {
  const response = await invoke<{
    announcement: ChatGroupAnnouncement;
    announcements: ChatGroupAnnouncement[];
    group: ChatGroup;
    conversation: ApiConversation;
  }>("update_chat_group_announcement", input);
  return {
    announcement: response.announcement,
    announcements: response.announcements,
    group: response.group,
    conversation: mapConversation(response.conversation),
  };
}

export async function deleteChatGroupAnnouncement(input: {
  groupId: string;
  announcementId: number;
}): Promise<{
  announcements: ChatGroupAnnouncement[];
  canManage: boolean;
  maxCount: number;
}> {
  return invoke<{
    announcements: ChatGroupAnnouncement[];
    canManage: boolean;
    maxCount: number;
  }>("delete_chat_group_announcement", input);
}

export async function listChatGroupMembers(
  groupId: string,
): Promise<ChatGroupMember[]> {
  const response = await invoke<{ members: ChatGroupMember[] }>(
    "list_chat_group_members",
    { groupId },
  );
  return response.members;
}

export async function updateMyChatGroupMember(input: {
  groupId: string;
  groupNickname?: string | null;
}): Promise<ChatGroupMember[]> {
  const response = await invoke<{ members: ChatGroupMember[] }>(
    "update_my_chat_group_member",
    {
      groupId: input.groupId,
      groupNickname: input.groupNickname ?? null,
    },
  );
  return response.members;
}

export async function inviteChatGroupMembers(input: {
  groupId: string;
  memberUserIds: number[];
  message?: string | null;
}): Promise<ChatGroupMember[]> {
  const response = await invoke<{ members: ChatGroupMember[] }>(
    "invite_chat_group_members",
    {
      groupId: input.groupId,
      memberUserIds: input.memberUserIds,
      message: input.message ?? null,
    },
  );
  return response.members;
}

export async function loadChatGroupNotifications(): Promise<ChatGroupJoinRequest[]> {
  const response = await invoke<{ requests: ChatGroupJoinRequest[] }>(
    "list_chat_group_notifications",
  );
  return response.requests;
}

export async function acceptChatGroupJoinRequest(
  requestId: number,
): Promise<ChatGroupJoinRequest> {
  const response = await invoke<{ request: ChatGroupJoinRequest }>(
    "accept_chat_group_join_request",
    { requestId },
  );
  return response.request;
}

export async function rejectChatGroupJoinRequest(
  requestId: number,
): Promise<ChatGroupJoinRequest> {
  const response = await invoke<{ request: ChatGroupJoinRequest }>(
    "reject_chat_group_join_request",
    { requestId },
  );
  return response.request;
}

export async function sendChatGroupJoinRequest(input: {
  groupId: string;
  message?: string | null;
}): Promise<ChatGroupJoinRequest> {
  const response = await invoke<{ request: ChatGroupJoinRequest }>(
    "send_chat_group_join_request",
    {
      groupId: input.groupId,
      message: input.message ?? null,
    },
  );
  return response.request;
}

export async function setChatGroupAdmin(input: {
  groupId: string;
  userId: number;
}): Promise<ChatGroupMember[]> {
  const response = await invoke<{ members: ChatGroupMember[] }>(
    "set_chat_group_admin",
    input,
  );
  return response.members;
}

export async function unsetChatGroupAdmin(input: {
  groupId: string;
  userId: number;
}): Promise<ChatGroupMember[]> {
  const response = await invoke<{ members: ChatGroupMember[] }>(
    "unset_chat_group_admin",
    input,
  );
  return response.members;
}

export async function transferChatGroupOwner(input: {
  groupId: string;
  userId: number;
}): Promise<ChatGroupMember[]> {
  const response = await invoke<{ members: ChatGroupMember[] }>(
    "transfer_chat_group_owner",
    input,
  );
  return response.members;
}

export async function removeChatGroupMember(input: {
  groupId: string;
  userId: number;
}): Promise<ChatGroupMember[]> {
  const response = await invoke<{ members: ChatGroupMember[] }>(
    "remove_chat_group_member",
    input,
  );
  return response.members;
}

export async function leaveChatGroup(groupId: string): Promise<ChatGroupMember[]> {
  const response = await invoke<{ members: ChatGroupMember[] }>("leave_chat_group", {
    groupId,
  });
  return response.members;
}

export async function dissolveChatGroup(groupId: string): Promise<void> {
  await invoke("dissolve_chat_group", { groupId });
}

export async function markConversationRead(
  conversationId: string,
  conversationSeq: number,
): Promise<void> {
  await invoke("mark_chat_conversation_read", {
    conversationId,
    conversationSeq,
  });
}

export async function setConversationPinned(
  conversationId: string,
  pinned: boolean,
): Promise<void> {
  await invoke("set_chat_conversation_pinned", {
    conversationId,
    pinned,
  });
}

export async function setConversationMuted(
  conversationId: string,
  muted: boolean,
): Promise<void> {
  await invoke("set_chat_conversation_muted", {
    conversationId,
    muted,
  });
}

export async function clearConversationHistory(
  conversationId: string,
): Promise<void> {
  await invoke("clear_chat_conversation_history", { conversationId });
}

export async function archiveConversation(
  conversationId: string,
): Promise<void> {
  await invoke("archive_chat_conversation", { conversationId });
}

export async function startChatRealtime(): Promise<void> {
  await invoke("start_chat_realtime");
}

export async function stopChatRealtime(): Promise<void> {
  await invoke("stop_chat_realtime");
}

export async function listenForNewChatMessages(
  onMessage: (message: ChatMessage) => void,
): Promise<() => void> {
  return listen<{ payload?: { message?: ApiMessage } }>(
    "chat-message-new",
    (event) => {
      const message = event.payload.payload?.message;
      if (message) {
        onMessage(mapMessage(message, "incoming"));
      }
    },
  );
}

export async function listenForRevokedChatMessages(
  onMessage: (message: ChatMessage) => void,
): Promise<() => void> {
  return listen<{ payload?: { message?: ApiMessage } }>(
    "chat-message-revoked",
    (event) => {
      const message = event.payload.payload?.message;
      if (message) {
        onMessage(mapMessage(message, "incoming"));
      }
    },
  );
}

export async function listenForDeletedChatMessages(
  onEvent: (event: ChatMessageDeletedEvent) => void,
): Promise<() => void> {
  return listen<ChatMessageDeletedEvent>(
    "chat-message-deleted",
    (event) => {
      const payload = event.payload;
      if (payload?.messageId && payload.conversationId) {
        onEvent(payload);
      }
    },
  );
}

export async function listenForFriendRequestEvents(
  onEvent: (event: FriendRealtimeEvent) => void,
): Promise<() => void> {
  return listen<{
    event?: FriendRealtimeEvent["event"];
    payload?: { request?: FriendRequest };
  }>(FRIEND_REQUEST_EVENT, (event) => {
    const eventName = event.payload.event;
    const request = event.payload.payload?.request;
    if (
      request &&
      (eventName === "friend.request.created" ||
        eventName === "friend.request.accepted" ||
        eventName === "friend.request.rejected")
    ) {
      onEvent({ event: eventName, request });
    }
  });
}

export async function listenForGroupEvents(
  onEvent: (event: ChatGroupRealtimeEvent) => void,
): Promise<() => void> {
  return listen<{
    event?: ChatGroupRealtimeEvent["event"];
    payload?: {
      group?: ChatGroup | null;
      conversation?: ApiConversation | null;
      request?: ChatGroupJoinRequest | null;
      announcements?: ChatGroupAnnouncement[] | null;
    };
  }>(CHAT_GROUP_EVENT, (event) => {
    const eventName = event.payload.event;
    if (
      eventName === "group.created" ||
      eventName === "group.updated" ||
      eventName === "group.announcement.updated" ||
      eventName === "group.member.added" ||
      eventName === "group.member.removed" ||
      eventName === "group.member.role_changed" ||
      eventName === "group.join_request.created" ||
      eventName === "group.join_request.handled" ||
      eventName === "group.dissolved"
    ) {
      onEvent({
        event: eventName,
        group: event.payload.payload?.group ?? null,
        conversation: event.payload.payload?.conversation
          ? mapConversation(event.payload.payload.conversation)
          : null,
        request: event.payload.payload?.request ?? null,
        announcements: event.payload.payload?.announcements ?? null,
      });
    }
  });
}

function mapConversation(item: ApiConversation): ChatConversation {
  const kind = normalizeKind(item.type);
  const title = item.title || "未命名会话";
  return {
    id: item.id,
    kind,
    title,
    subtitle: item.lastMessagePreview || "暂无消息",
    timeLabel: formatTimeLabel(item.lastMessageAt || item.updatedAt || item.createdAt),
    unreadCount: item.unreadCount ?? 0,
    pinned: Boolean(item.pinned),
    muted: Boolean(item.muted),
    groupId: item.groupId ?? null,
    groupMemberCount: item.groupMemberCount ?? null,
    groupAvatarUrl: item.groupAvatarUrl ?? null,
    currentUserId: item.currentUserId ?? null,
    participant: {
      id: String(item.peerUserId ?? item.groupId ?? item.deviceId ?? item.id),
      name: title,
      team: kind === "group" ? "群聊" : kind === "device" ? "设备" : "联系人",
      avatar: title.slice(0, 1).toUpperCase(),
      avatarUrl: kind === "group" ? item.groupAvatarUrl ?? null : null,
      presence: "offline",
      presenceLabel:
        kind === "group"
          ? `${item.groupMemberCount ?? 0} 人`
          : kind === "device"
            ? "设备状态待同步"
            : "在线状态待同步",
      lastSeenLabel: kind === "group" ? "群聊" : "来自云端会话",
    },
  };
}

function mapMessage(
  item: ApiMessage,
  fallbackDirection: "incoming" | "outgoing",
): ChatMessage {
  const kind = normalizeMessageKind(item.messageType, item.status);
  return {
    id: item.id,
    conversationId: item.conversationId,
    kind,
    direction: kind === "system" ? undefined : fallbackDirection,
    content: item.content,
    contentJson: item.contentJson ?? null,
    fileObjectId: item.fileObjectId ?? null,
    timeLabel: formatTimeLabel(item.createdAt),
    createdAt: item.createdAt ?? null,
    senderId: item.senderId,
    serverSeq: item.serverSeq,
    conversationSeq: item.conversationSeq,
    status: item.status,
  };
}

function normalizeMessageKind(messageType: string, status?: string): ChatMessageKind {
  if (status === "revoked") {
    return "system";
  }
  if (
    messageType === "image" ||
    messageType === "file" ||
    messageType === "sticker" ||
    messageType === "system" ||
    messageType === "call_event"
  ) {
    return messageType;
  }
  return "text";
}

function normalizeKind(value: string): ConversationKind {
  if (value === "group" || value === "device") {
    return value;
  }
  return "direct";
}

function formatTimeLabel(value?: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${date.getHours().toString().padStart(2, "0")}:${date
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
