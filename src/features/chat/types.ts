export type ChatPresence = "online" | "away" | "offline";

export type ConversationKind = "direct" | "group" | "device";

export type ChatMessageKind =
  | "text"
  | "image"
  | "video"
  | "voice"
  | "file"
  | "sticker"
  | "system"
  | "call_event"
  | "contact_card"
  | "group_card"
  | "group_share_card";

export type QuoteMeta = {
  quotedMessageId: string;
  quotedConversationId: string;
  quotedConversationSeq?: number | null;
  quotedSenderId?: number | null;
  quotedSenderName: string;
  quotedMessageType: ChatMessageKind | string;
  previewText: string;
  thumbnailUrl?: string | null;
  fileObjectId?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  duration?: number | null;
  isDeleted?: boolean;
  isRevoked?: boolean;
  quotedCreatedAt?: string | null;
};

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
  accountType?: "normal" | "class" | string | null;
  classNo?: string | null;
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
  groupType?: "normal" | "class" | string | null;
  groupMemberCount?: number | null;
  groupAvatarUrl?: string | null;
  groupAvatarObjectKey?: string | null;
};

export type ChatGroup = {
  id: string;
  groupNo?: string | null;
  groupType?: "normal" | "class" | string;
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
  accountType?: "normal" | "class" | string;
  classNo?: string | null;
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

export type ChatGroupInvite = {
  inviteToken: string;
  inviteUrl: string;
  expireAt?: string | null;
  valid: boolean;
  reason?: string | null;
  group: ChatGroup;
};

export type ChatGroupInviteApplyResult = {
  status: "pending" | "joined" | string;
  request?: ChatGroupJoinRequest | null;
  group?: ChatGroup | null;
  conversation?: ChatConversation | null;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  kind: ChatMessageKind;
  direction?: "incoming" | "outgoing";
  content: string;
  contentJson?: Record<string, unknown> | null;
  quoteMeta?: QuoteMeta | null;
  fileObjectId?: string | null;
  fileAccess?: {
    status: "active" | "expired" | "revoked" | "deleted" | "blocked" | "none" | string;
    reason?: string | null;
    expireAt?: string | null;
    messageFileRefId?: string | null;
  } | null;
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
  sha256?: string | null;
  ext?: string | null;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  status?: string;
  url?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type LocalUploadFile = {
  path: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  fileType: "image" | "video" | "file" | "sticker" | string;
};

export type ChatFileDropEvent = {
  files: LocalUploadFile[];
};

export type TransferTaskStatus =
  | "waiting"
  | "hashing"
  | "uploading"
  | "downloading"
  | "paused"
  | "failed"
  | "completed"
  | "canceled"
  | "instant_completed";

export type ChatTransferEvent = {
  taskId: string;
  status: TransferTaskStatus | string;
  fileName?: string;
  fileSize?: number;
  uploadedBytes?: number;
  downloadedBytes?: number;
  speedBytes?: number;
  remainingSeconds?: number | null;
  uploadId?: string;
  errorMessage?: string | null;
  file?: UploadedChatFile | null;
};

export type DriveNode = {
  id: string;
  driveType: "personal" | "group" | string;
  ownerUserId?: number | null;
  groupId?: string | null;
  parentId?: string | null;
  type: "folder" | "file" | string;
  name: string;
  fileObjectId?: string | null;
  file?: UploadedChatFile | null;
  createdByUserId: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  canManage?: boolean;
};

export type ChatFileDownloadResult = {
  path?: string;
  cancelled?: boolean;
};

export type ImagePreviewItem = {
  id: string;
  sourceMessageId?: string | null;
  url?: string | null;
  fileObjectId?: string | null;
  fileName: string;
};

export type ImagePreviewOpenPayload = {
  images: ImagePreviewItem[];
  activeId: string;
};

export type MediaViewerItem = {
  id: string;
  messageId: string;
  conversationId: string;
  sourceMessageId?: string | null;
  messageFileRefId?: string | null;
  source: "chat" | "personal_drive" | "group_drive" | "local_pending";
  sourceId: string;
  type: "image" | "video";
  localPosterUrl?: string | null;
  fileObjectId?: string | null;
  thumbnailObjectId?: string | null;
  fileName: string;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  senderId?: number | null;
  senderName?: string | null;
  sentAt?: string | null;
  seq?: number | null;
  localCandidates?: MediaViewerLocalCandidate[];
};

export type MediaViewerLocalCandidate = {
  path: string;
  label?: string | null;
  sourceType?: "local_original" | "local_download" | "local_preview_cache" | string | null;
};

export type MediaViewerOpenPayload = {
  conversationId: string;
  conversationTitle?: string | null;
  activeId: string;
  currentIndex: number;
  mediaList: MediaViewerItem[];
};

export type MediaAccessSource =
  | "chat"
  | "personal_drive"
  | "group_drive"
  | "local_pending";

export type ResolvedMediaSourceStatus =
  | "ready"
  | "expired"
  | "no_permission"
  | "deleted"
  | "blocked"
  | "not_uploaded"
  | "loading"
  | "failed";

export type ResolvedMediaSourceType =
  | "local_original"
  | "local_download"
  | "local_preview_cache"
  | "signed_preview_url"
  | "signed_download_url"
  | "none";

export type MediaAllowedActions = {
  preview: boolean;
  download: boolean;
  forward: boolean;
  saveToPersonalDrive: boolean;
  saveToGroupDrive: boolean;
  openLocal: boolean;
  openContainingFolder: boolean;
  reupload: boolean;
};

export type ResolvedMediaSource = {
  status: ResolvedMediaSourceStatus;
  sourceType: ResolvedMediaSourceType;
  playableUrl?: string;
  localPath?: string | null;
  expiresAt?: string | null;
  allowedActions: MediaAllowedActions;
  reasonText?: string;
  fallback?: {
    personalDriveNodeId?: string | null;
    groupDriveNodeId?: string | null;
  } | null;
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
