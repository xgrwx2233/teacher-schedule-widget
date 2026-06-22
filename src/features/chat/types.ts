export type ChatPresence = "online" | "away" | "offline";

export type ConversationKind = "direct" | "group" | "device";

export type ChatMessageKind =
  | "text"
  | "image"
  | "file"
  | "sticker"
  | "system"
  | "call_event";

export type ChatSticker = {
  id: string;
  fileObjectId: string;
  fileName: string;
  contentType?: string | null;
  sizeBytes: number;
  url?: string | null;
  createdAt: number;
};

export type ChatParticipant = {
  id: string;
  name: string;
  team: string;
  avatar: string;
  avatarUrl?: string | null;
  presence: ChatPresence;
  presenceLabel: string;
  lastSeenLabel: string;
};

export type ChatConversation = {
  id: string;
  kind: ConversationKind;
  participant: ChatParticipant;
  title: string;
  subtitle: string;
  timeLabel: string;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
  currentUserId?: number | null;
  groupId?: string | null;
  groupMemberCount?: number | null;
  groupAvatarUrl?: string | null;
};

export type ChatGroup = {
  id: string;
  conversationId: string;
  name: string;
  avatarUrl?: string | null;
  avatarObjectKey?: string | null;
  description?: string | null;
  announcement?: string | null;
  ownerUserId: number;
  memberLimit: number;
  memberCount: number;
  joinPolicy: string;
  status: string;
  currentUserRole: "owner" | "admin" | "member" | string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ChatGroupMember = {
  userId: number;
  nickname: string;
  avatarUrl?: string | null;
  avatarObjectKey?: string | null;
  role: "owner" | "admin" | "member" | string;
  groupNickname?: string | null;
  status: string;
  joinedAt?: string | null;
};

export type ChatGroupAnnouncement = {
  id: number;
  groupId: string;
  content: string;
  createdByUserId: number;
  updatedByUserId: number;
  createdByProfile?: import("../profile/types").UserProfile | null;
  updatedByProfile?: import("../profile/types").UserProfile | null;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  canManage?: boolean;
};

export type ChatGroupJoinRequest = {
  id: number;
  groupId: string;
  groupName: string;
  groupAvatarUrl?: string | null;
  applicantUserId: number;
  inviterUserId?: number | null;
  message?: string | null;
  status: "pending" | "accepted" | "rejected" | string;
  handledByUserId?: number | null;
  createdAt?: string | null;
  handledAt?: string | null;
  applicantProfile?: import("../profile/types").UserProfile | null;
  inviterProfile?: import("../profile/types").UserProfile | null;
  handledByProfile?: import("../profile/types").UserProfile | null;
  canHandle?: boolean;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  kind: ChatMessageKind;
  direction?: "incoming" | "outgoing";
  content: string;
  contentJson?: Record<string, unknown> | null;
  fileObjectId?: string | null;
  timeLabel?: string;
  createdAt?: string | null;
  senderId?: number;
  serverSeq?: number;
  conversationSeq?: number;
  status?: string;
};

export type UploadedChatFile = {
  id: string;
  objectKey: string;
  fileType: string;
  contentType?: string | null;
  originalName?: string | null;
  sizeBytes: number;
  url?: string | null;
  createdAt?: string | null;
};

export type ChatFileDownloadResult = {
  path?: string;
  cancelled?: boolean;
};

export type ImagePreviewItem = {
  id: string;
  url?: string | null;
  fileObjectId?: string | null;
  fileName: string;
};

export type ImagePreviewOpenPayload = {
  images: ImagePreviewItem[];
  activeId: string;
};

export type ConversationContextMenu = {
  conversationId: string;
  x: number;
  y: number;
} | null;

export type ChatDataSourceState = {
  loading: boolean;
  live: boolean;
  error?: string | null;
};
