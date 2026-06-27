import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  type DragDropEvent as TauriDragDropEvent,
} from "@tauri-apps/api/window";
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  archiveConversation,
  cacheChatFile,
  acceptChatGroupJoinRequest,
  controlChatUploadTask,
  clearConversationHistory,
  applyChatGroupInvite,
  createDirectConversation,
  createChatGroup,
  createChatGroupInvite,
  createDriveFolder,
  deleteChatMessageForMe,
  dissolveChatGroup,
  downloadChatFile,
  forwardDriveNodeToChat,
  getChatGroupInvite,
  inspectChatUploadFiles,
  inviteChatGroupMembers,
  leaveChatGroup,
  loadChatConversations,
  loadChatGroup,
  loadChatHistoryMessages,
  loadChatMessages,
  listenForDeletedChatMessages,
  listenForChatTransferEvents,
  listenForFriendRequestEvents,
  listenForGroupEvents,
  listenForNewChatMessages,
  listenForRevokedChatMessages,
  loadChatGroupNotifications,
  listDriveNodes,
  listChatGroupMembers,
  markConversationRead,
  openCachedChatFile,
  pickChatUploadFiles,
  postChatMessage,
  postTypedChatMessage,
  rejectChatGroupJoinRequest,
  removeChatGroupMember,
  revokeChatMessage,
  sendChatGroupJoinRequest,
  setChatGroupAdmin,
  setConversationMuted,
  setConversationPinned,
  saveFileToDrive,
  saveChatVideoPoster,
  startChatRealtime,
  stopChatRealtime,
  transferChatGroupOwner,
  unsetChatGroupAdmin,
  updateChatGroup,
  updateMyChatGroupMember,
  uploadChatFileBytes,
  uploadChatFilePathChunked,
} from "../../features/chat/chatRepository";
import { forwardChatMessage } from "../../features/chat/chatForwarding";
import {
  chatAccountKeyFromState,
  clearCachedConversationMessages,
  loadChatAccountCache,
  saveChatAccountCache,
} from "../../features/chat/chatLocalCache";
import {
  fileNameFromMessage,
  fileObjectIdFromMessage,
  fileTypeFromMessage,
  fileUrlFromMessage,
  chatFileAccessReason,
  chatFileCloudAvailable,
  chatFileAccessStatus,
  chatMessageFileAccessSource,
  officialChatMessageId,
  contentTypeFromFilename,
  formatBytes,
  isMediaMessage,
  isVideoMessage,
  mediaViewerItemFromMessage,
  messagePreview,
  quoteMetaFromMessage,
  quoteFromMessage,
  sizeBytesFromMessage,
  withQuoteMeta,
} from "../../features/chat/chatMessageUtils";
import { mockConversations, mockMessages } from "../../features/chat/mockChat";
import type { LocalAccountState } from "../../features/account/types";
import {
  acceptFriendRequest,
  cacheProfileAvatar,
  listFriendRequests,
  listFriends,
  loadMyProfile,
  loadUserProfile,
  profileInitial,
  rejectFriendRequest,
  deleteFriend,
  uploadProfileAvatarBytes,
} from "../../features/profile/profileRepository";
import type { FriendRequest, UserProfile } from "../../features/profile/types";
import {
  AUTH_STATE_CHANGED_EVENT,
  CHAT_FORWARD_MESSAGE_EVENT,
  CHAT_LOCATE_MESSAGE_EVENT,
  CHAT_OPEN_CONVERSATION_EVENT,
  CHAT_QUOTE_MESSAGE_EVENT,
  FRIEND_REQUEST_SENT_EVENT,
  PROFILE_UPDATED_EVENT,
} from "../../features/settings/windowEvents";
import type {
  ChatConversation,
  ChatDataSourceState,
  ChatGroup,
  ChatGroupInvite,
  ChatGroupJoinRequest,
  ChatGroupMember,
  ChatMessage,
  ChatMessageKind,
  ChatSticker,
  ChatTransferEvent,
  ConversationContextMenu,
  DriveNode,
  LocalUploadFile,
  MediaViewerItem,
  QuoteMeta,
  TransferTaskStatus,
  UploadedChatFile,
} from "../../features/chat/types";
import { FriendProfileView } from "../Profile/ProfileViews";
import { RtcTestPanel } from "./RtcTestPanel";
import BellIcon from "../../../images/bell.svg";
import CameraIcon from "../../../images/camera.svg";
import EllipsisIcon from "../../../images/ellipsis.svg";
import FolderClosedIcon from "../../../images/folder-closed.svg";
import HistoryIcon from "../../../images/history.svg";
import MenuIcon from "../../../images/menu.svg";
import MessageCircleMoreIcon from "../../../images/message-circle-more.svg";
import MicIcon from "../../../images/mic.svg";
import PlusIcon from "../../../images/plus (1).svg";
import SearchIcon from "../../../images/search.svg";
import ScissorsIcon from "../../../images/Scissors.svg";
import ShareIcon from "../../../images/share.svg";
import SmileIcon from "../../../images/smile.svg";
import UsersRoundIcon from "../../../images/users-round.svg";

type ChatSection = "messages" | "contacts" | "drive";
type ContactDetailView =
  | "empty"
  | "friend"
  | "group"
  | "friend-requests"
  | "group-requests";
type ContactListTab = "friends" | "groups";
type MessageContextMenu = {
  messageId: string;
  x: number;
  y: number;
} | null;
type MessageMenuAction =
  | "open"
  | "play"
  | "forward"
  | "multi-select"
  | "quote"
  | "revoke"
  | "delete"
  | "download"
  | "save-personal-drive"
  | "save-group-drive"
  | "copy-file-name";
type GroupMemberContextMenu = {
  groupId: string;
  memberUserId: number;
  x: number;
  y: number;
} | null;
type GroupConfirmAction =
  | "set-admin"
  | "unset-admin"
  | "transfer-owner"
  | "remove-member"
  | "remove-members"
  | "leave-group"
  | "dissolve-group"
  | "clear-history"
  | "delete-friend";
type GroupConfirmState = {
  action: GroupConfirmAction;
  groupId: string;
  conversationId?: string;
  memberUserId?: number;
  memberUserIds?: number[];
  title: string;
  description: string;
  confirmText: string;
  danger?: boolean;
} | null;
type GroupSettingsView = "main" | "profile";
type QuotedMessage = QuoteMeta;
type ForwardPickerState = {
  messageIds: string[];
} | null;
type DriveForwardPickerState = {
  nodeId: string;
  nodeName: string;
} | null;
type TransferTask = {
  id: string;
  direction: "upload" | "download";
  conversationId?: string | null;
  localMessageId?: string | null;
  fileName: string;
  filePath?: string | null;
  fileType: "image" | "video" | "file" | "sticker";
  contentType?: string | null;
  fileSize: number;
  uploadedBytes: number;
  downloadedBytes: number;
  status: TransferTaskStatus | string;
  speedBytes?: number;
  remainingSeconds?: number | null;
  errorMessage?: string | null;
  fileObjectId?: string | null;
  createdAt: number;
  updatedAt: number;
  saveToPersonalDrive?: boolean;
  saveToGroupDrive?: boolean;
};
type VideoPosterSnapshot = {
  bytes: number[];
  dataUrl: string;
  localPath?: string | null;
  localUrl?: string | null;
  width: number;
  height: number;
  score: number;
  timeSeconds: number;
};
type DrivePanelMode = "personal" | "group";
type DriveFilter = "all" | "image" | "video" | "document" | "archive" | "other";
type DriveViewMode = "list" | "grid";
type DriveSortMode = "updated" | "name" | "size" | "type";
type CreateGroupType = "normal" | "class";
type DrivePanelState = {
  mode: DrivePanelMode;
  groupId?: string | null;
  title: string;
  open: boolean;
  nodes: DriveNode[];
  breadcrumb: DriveNode[];
  loading: boolean;
  error?: string | null;
  search: string;
  filter: DriveFilter;
  viewMode: DriveViewMode;
  sortMode: DriveSortMode;
  selectedIds: string[];
};
type DriveSaveNotice = {
  id: string;
  label: string;
} | null;
type EmojiPanelTab = "emoji" | "stickers";
type CardSubjectKind = "contact" | "group";
type ShareCardSubject = {
  kind: CardSubjectKind;
  id: string;
  title: string;
  subtitle?: string;
  avatarUrl?: string | null;
  avatarObjectKey?: string | null;
  description?: string | null;
  memberCount?: number | null;
  conversationId?: string | null;
  invite?: ChatGroupInvite | null;
};
type ShareCardRecipient = {
  key: string;
  kind: "friend" | "group";
  id: string;
  conversationId?: string | null;
  title: string;
  subtitle: string;
  avatarLabel: string;
  avatarUrl?: string | null;
};
type ShareCardDialogState = {
  subject: ShareCardSubject;
  selectedKeys: string[];
  search: string;
  note: string;
  sending: boolean;
  error?: string | null;
} | null;
type GroupShareDialogState = {
  group: GroupProfileSnapshot;
  invite: ChatGroupInvite | null;
  qrDataUrl: string | null;
  loading: boolean;
  saving: boolean;
  forwarding: boolean;
  error?: string | null;
} | null;
type ProfileCardAnchor = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};
type ProfileCardMode = "hover" | "pinned";
type GroupMembershipState = "joined" | "pending" | "not_joined";
type GroupProfileSnapshot = {
  id: string;
  groupNo?: string | null;
  conversationId?: string | null;
  name: string;
  avatarUrl?: string | null;
  avatarObjectKey?: string | null;
  description?: string | null;
  announcement?: string | null;
  memberCount?: number | null;
  inviteToken?: string | null;
};
type ProfileCardState =
  | {
      kind: "friend";
      mode: ProfileCardMode;
      anchor?: ProfileCardAnchor | null;
      profile: UserProfile;
    }
  | {
      kind: "group";
      mode: ProfileCardMode;
      anchor?: ProfileCardAnchor | null;
      group: GroupProfileSnapshot;
      membership: GroupMembershipState;
      loading: boolean;
      membersLoading: boolean;
      members: ChatGroupMember[];
    }
  | null;

const STICKER_ACCEPT = "image/png,image/gif,image/webp";
const CHAT_TIMELINE_GAP_MS = 5 * 60 * 1000;
const LARGE_FILE_CONFIRM_BYTES = 100 * 1024 * 1024;
const DEFAULT_CHAT_CHUNK_SIZE = 4 * 1024 * 1024;
const VIDEO_POSTER_TARGET_WIDTH = 720;
const VIDEO_POSTER_QUALITY = 0.82;
const VIDEO_POSTER_GOOD_SCORE = 36;
const VIDEO_POSTER_METADATA_TIMEOUT_MS = 5000;
const VIDEO_POSTER_SEEK_TIMEOUT_MS = 3500;
const VIDEO_POSTER_TOTAL_TIMEOUT_MS = 12000;
const GROUP_NICKNAME_MAX_LENGTH = 30;
const CHAT_LIST_WIDTH_STORAGE_KEY = "teacher-schedule.chatWindow.listWidth";
const CHAT_COMPOSER_HEIGHT_STORAGE_KEY =
  "teacher-schedule.chatWindow.composerHeight";
const CHAT_LIST_DEFAULT_WIDTH = 250;
const CHAT_LIST_MIN_WIDTH = 180;
const CHAT_LIST_MAX_WIDTH = 400;
const CHAT_MAIN_MIN_WIDTH = 560;
const CHAT_COMPOSER_DEFAULT_HEIGHT = 158;
const CHAT_COMPOSER_MIN_HEIGHT = 150;
const CHAT_COMPOSER_MAX_HEIGHT = 360;
const CHAT_MESSAGE_MIN_HEIGHT = 210;
const COMMON_EMOJIS = [
  "😀",
  "😃",
  "😂",
  "😊",
  "😍",
  "🤗",
  "😎",
  "😭",
  "😄",
  "😆",
  "😉",
  "🤔",
  "👍",
  "👏",
  "🙏",
  "💪",
  "❤️",
  "💯",
  "🎉",
  "⭐",
  "☀️",
  "🍁",
  "📎",
  "✏️",
  "✓",
  "❤",
  "💙",
  "💕",
  "🔥",
  "🌟",
  "🧡",
  "🤝",
];

const chatIconMap = {
  bell: BellIcon,
  camera: CameraIcon,
  ellipsis: EllipsisIcon,
  folder: FolderClosedIcon,
  history: HistoryIcon,
  menu: MenuIcon,
  message: MessageCircleMoreIcon,
  mic: MicIcon,
  plus: PlusIcon,
  search: SearchIcon,
  scissors: ScissorsIcon,
  share: ShareIcon,
  smile: SmileIcon,
  users: UsersRoundIcon,
} as const;

type ChatIconName = keyof typeof chatIconMap;

function mediaDebug(label: string, payload: Record<string, unknown>): void {
  console.info(`[media-debug] ${label}`, payload);
  void invoke("media_debug_log", { label, payload }).catch(() => undefined);
}

function ChatIcon({
  name,
  className,
}: {
  name: ChatIconName;
  className?: string;
}) {
  return (
    <span
      className={className ? `chat-icon ${className}` : "chat-icon"}
      style={{ "--chat-icon-url": `url("${chatIconMap[name]}")` } as CSSProperties}
      aria-hidden="true"
    />
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function readStoredLayoutNumber(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clampNumber(parsed, min, max);
}

function writeStoredLayoutNumber(key: string, value: number): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // Layout persistence is a convenience; resizing should keep working without it.
  }
}

export function ChatWindow() {
  const [conversations, setConversations] =
    useState<ChatConversation[]>(mockConversations);
  const [messages, setMessages] = useState<ChatMessage[]>(mockMessages);
  const [activeConversationId, setActiveConversationId] = useState(
    mockConversations[0]?.id ?? "",
  );
  const activeConversationIdRef = useRef(activeConversationId);
  const [dataSource, setDataSource] = useState<ChatDataSourceState>({
    loading: true,
    live: false,
    error: null,
  });
  const [accountState, setAccountState] = useState<LocalAccountState | null>(
    null,
  );
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
  const [profileMap, setProfileMap] = useState<Record<number, UserProfile>>({});
  const [avatarUrlMap, setAvatarUrlMap] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [historyExhaustedMap, setHistoryExhaustedMap] = useState<Record<string, boolean>>({});
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [screenshotMenuOpen, setScreenshotMenuOpen] = useState(false);
  const [hideChatWhenScreenshot, setHideChatWhenScreenshot] = useState(false);
  const [chatListWidth, setChatListWidth] = useState(() =>
    readStoredLayoutNumber(
      CHAT_LIST_WIDTH_STORAGE_KEY,
      CHAT_LIST_DEFAULT_WIDTH,
      CHAT_LIST_MIN_WIDTH,
      CHAT_LIST_MAX_WIDTH,
    ),
  );
  const [composerHeight, setComposerHeight] = useState(() =>
    readStoredLayoutNumber(
      CHAT_COMPOSER_HEIGHT_STORAGE_KEY,
      CHAT_COMPOSER_DEFAULT_HEIGHT,
      CHAT_COMPOSER_MIN_HEIGHT,
      CHAT_COMPOSER_MAX_HEIGHT,
    ),
  );
  const [conversationMenu, setConversationMenu] =
    useState<ConversationContextMenu>(null);
  const [messageMenu, setMessageMenu] = useState<MessageContextMenu>(null);
  const [groupMemberMenu, setGroupMemberMenu] = useState<GroupMemberContextMenu>(null);
  const [groupConfirm, setGroupConfirm] = useState<GroupConfirmState>(null);
  const [groupActionBusy, setGroupActionBusy] = useState(false);
  const [quotedMessage, setQuotedMessage] = useState<QuotedMessage | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [forwardPicker, setForwardPicker] = useState<ForwardPickerState>(null);
  const [driveForwardPicker, setDriveForwardPicker] =
    useState<DriveForwardPickerState>(null);
  const [transferTasks, setTransferTasks] = useState<TransferTask[]>([]);
  const [transferDrawerOpen, setTransferDrawerOpen] = useState(false);
  const [chatDragActive, setChatDragActive] = useState(false);
  const [transferTab, setTransferTab] =
    useState<"uploading" | "downloading" | "completed">("uploading");
  const [drivePanel, setDrivePanel] = useState<DrivePanelState>({
    mode: "personal",
    groupId: null,
    title: "我的网盘",
    open: false,
    nodes: [],
    breadcrumb: [],
    loading: false,
    error: null,
    search: "",
    filter: "all",
    viewMode: "list",
    sortMode: "updated",
    selectedIds: [],
  });
  const [driveSaveNotice, setDriveSaveNotice] =
    useState<DriveSaveNotice>(null);
  const [profileCard, setProfileCard] = useState<ProfileCardState>(null);
  const [shareCard, setShareCard] = useState<ShareCardDialogState>(null);
  const [groupShareDialog, setGroupShareDialog] =
    useState<GroupShareDialogState>(null);
  const [rtcTestOpen, setRtcTestOpen] = useState(false);
  const [emojiPanelOpen, setEmojiPanelOpen] = useState(false);
  const [emojiPanelTab, setEmojiPanelTab] = useState<EmojiPanelTab>("emoji");
  const [stickers, setStickers] = useState<ChatSticker[]>([]);
  const [stickerUploading, setStickerUploading] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createGroupType, setCreateGroupType] =
    useState<CreateGroupType>("normal");
  const [createGroupSearch, setCreateGroupSearch] = useState("");
  const [createGroupName, setCreateGroupName] = useState("");
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<number[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createGroupError, setCreateGroupError] = useState<string | null>(null);
  const [inviteGroupOpen, setInviteGroupOpen] = useState(false);
  const [inviteGroupSearch, setInviteGroupSearch] = useState("");
  const [selectedInviteMemberIds, setSelectedInviteMemberIds] = useState<number[]>([]);
  const [invitingGroup, setInvitingGroup] = useState(false);
  const [inviteGroupError, setInviteGroupError] = useState<string | null>(null);
  const [inviteGroupNotice, setInviteGroupNotice] = useState<string | null>(null);
  const [removeGroupOpen, setRemoveGroupOpen] = useState(false);
  const [removeGroupSearch, setRemoveGroupSearch] = useState("");
  const [selectedRemoveMemberIds, setSelectedRemoveMemberIds] = useState<number[]>([]);
  const [removingGroupMembers, setRemovingGroupMembers] = useState(false);
  const [removeGroupError, setRemoveGroupError] = useState<string | null>(null);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [directSettingsOpen, setDirectSettingsOpen] = useState(false);
  const [groupSettingsView, setGroupSettingsView] =
    useState<GroupSettingsView>("main");
  const [groupOverviewHidden, setGroupOverviewHidden] = useState(false);
  const [groupMemberSearchOpen, setGroupMemberSearchOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupMap, setGroupMap] = useState<Record<string, ChatGroup>>({});
  const [groupMembersMap, setGroupMembersMap] = useState<Record<string, ChatGroupMember[]>>({});
  const [groupLoadingMap, setGroupLoadingMap] = useState<Record<string, boolean>>({});
  const [groupTitleEditing, setGroupTitleEditing] = useState(false);
  const [groupTitleDraft, setGroupTitleDraft] = useState("");
  const [groupTitleSaving, setGroupTitleSaving] = useState(false);
  const [groupNicknameEditing, setGroupNicknameEditing] = useState(false);
  const [groupNicknameDraft, setGroupNicknameDraft] = useState("");
  const [groupNicknameSaving, setGroupNicknameSaving] = useState(false);
  const [groupEditing, setGroupEditing] = useState(false);
  const [groupEditDraft, setGroupEditDraft] = useState({
    name: "",
    avatarUrl: null as string | null,
    avatarObjectKey: null as string | null,
    description: "",
    announcement: "",
  });
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupEditError, setGroupEditError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<ChatSection>("messages");
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [groupRequests, setGroupRequests] = useState<ChatGroupJoinRequest[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [activeContactUserId, setActiveContactUserId] = useState<number | null>(
    null,
  );
  const [activeContactGroupId, setActiveContactGroupId] = useState<string | null>(
    null,
  );
  const [contactListTab, setContactListTab] =
    useState<ContactListTab>("friends");
  const [contactDetailView, setContactDetailView] =
    useState<ContactDetailView>("empty");
  const currentUserId = Number(accountState?.user?.cloudUserId);
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const emojiPanelRef = useRef<HTMLElement | null>(null);
  const groupSettingsToggleRef = useRef<HTMLButtonElement | null>(null);
  const groupSettingsDrawerRef = useRef<HTMLElement | null>(null);
  const directSettingsDrawerRef = useRef<HTMLElement | null>(null);
  const chatListPanelRef = useRef<HTMLElement | null>(null);
  const chatMainPanelRef = useRef<HTMLElement | null>(null);
  const stickerInputRef = useRef<HTMLInputElement | null>(null);
  const groupAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const chatShellRef = useRef<HTMLElement | null>(null);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingSelfMessageScrollRef = useRef<string | null>(null);
  const chatRefreshSeqRef = useRef(0);
  const contactsRefreshSeqRef = useRef(0);
  const activeAccountKeyRef = useRef<string | null>(null);
  const conversationsRef = useRef(conversations);
  const messagesRef = useRef(messages);
  const friendsRef = useRef(friends);
  const friendRequestsRef = useRef(friendRequests);
  const groupRequestsRef = useRef(groupRequests);
  const activeSectionRef = useRef(activeSection);
  const activeContactUserIdRef = useRef<number | null>(activeContactUserId);
  const activeContactGroupIdRef = useRef<string | null>(activeContactGroupId);
  const contactListTabRef = useRef<ContactListTab>(contactListTab);
  const contactDetailViewRef = useRef<ContactDetailView>(contactDetailView);
  const currentUserIdRef = useRef<number | null>(null);
  const myProfileRef = useRef<UserProfile | null>(null);
  const profileMapRef = useRef<Record<number, UserProfile>>({});
  const avatarUrlMapRef = useRef<Record<string, string>>({});
  const stickersRef = useRef(stickers);
  const transferTasksRef = useRef(transferTasks);
  const sentLocalMediaPathRef = useRef<Record<string, string>>({});
  const drivePanelRef = useRef(drivePanel);
  const sendLocalUploadFilesRef = useRef<(files: LocalUploadFile[]) => Promise<void>>(
    async () => undefined,
  );
  const groupMapRef = useRef(groupMap);
  const groupMembersMapRef = useRef(groupMembersMap);
  const groupLoadingMapRef = useRef(groupLoadingMap);
  const hoverProfileShowTimerRef = useRef<number | null>(null);
  const hoverProfileHideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    friendsRef.current = friends;
  }, [friends]);

  useEffect(() => {
    friendRequestsRef.current = friendRequests;
  }, [friendRequests]);

  useEffect(() => {
    groupRequestsRef.current = groupRequests;
  }, [groupRequests]);

  useEffect(() => {
    myProfileRef.current = myProfile;
  }, [myProfile]);

  useEffect(() => {
    profileMapRef.current = profileMap;
  }, [profileMap]);

  useEffect(() => {
    avatarUrlMapRef.current = avatarUrlMap;
  }, [avatarUrlMap]);

  useEffect(() => {
    stickersRef.current = stickers;
  }, [stickers]);

  useEffect(() => {
    transferTasksRef.current = transferTasks;
  }, [transferTasks]);

  useEffect(() => {
    drivePanelRef.current = drivePanel;
  }, [drivePanel]);

  useEffect(() => {
    groupMapRef.current = groupMap;
  }, [groupMap]);

  useEffect(() => {
    groupMembersMapRef.current = groupMembersMap;
  }, [groupMembersMap]);

  useEffect(() => {
    groupLoadingMapRef.current = groupLoadingMap;
  }, [groupLoadingMap]);

  useEffect(() => {
    currentUserIdRef.current = Number.isInteger(currentUserId)
      ? currentUserId
      : null;
  }, [currentUserId]);

  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  useEffect(() => {
    activeContactUserIdRef.current = activeContactUserId;
  }, [activeContactUserId]);

  useEffect(() => {
    activeContactGroupIdRef.current = activeContactGroupId;
  }, [activeContactGroupId]);

  useEffect(() => {
    contactListTabRef.current = contactListTab;
  }, [contactListTab]);

  useEffect(() => {
    contactDetailViewRef.current = contactDetailView;
  }, [contactDetailView]);

  useEffect(() => {
    if (!activeAccountKeyRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      persistCurrentAccountCache();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    conversations,
    messages,
    friends,
    friendRequests,
    groupMap,
    groupMembersMap,
    groupRequests,
    myProfile,
    profileMap,
    avatarUrlMap,
    stickers,
    activeSection,
    activeConversationId,
    activeContactUserId,
    activeContactGroupId,
    contactListTab,
    contactDetailView,
  ]);

  useEffect(() => {
    if (!emojiPanelOpen) {
      return;
    }
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        emojiPanelRef.current?.contains(target) ||
        emojiButtonRef.current?.contains(target)
      ) {
        return;
      }
      setEmojiPanelOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
    };
  }, [emojiPanelOpen]);

  useEffect(() => {
    if (!groupSettingsOpen && !directSettingsOpen) {
      return;
    }
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        groupSettingsDrawerRef.current?.contains(target) ||
        directSettingsDrawerRef.current?.contains(target) ||
        groupSettingsToggleRef.current?.contains(target)
      ) {
        return;
      }
      if (
        chatListPanelRef.current?.contains(target) ||
        chatMainPanelRef.current?.contains(target)
      ) {
        setGroupSettingsOpen(false);
        setDirectSettingsOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
    };
  }, [directSettingsOpen, groupSettingsOpen]);

  const persistCurrentAccountCache = () => {
    saveChatAccountCache(activeAccountKeyRef.current, {
      conversations: conversationsRef.current,
      messages: messagesRef.current,
      friends: friendsRef.current,
      friendRequests: friendRequestsRef.current,
      groups: groupMapRef.current,
      groupMembers: groupMembersMapRef.current,
      groupRequests: groupRequestsRef.current,
      myProfile: myProfileRef.current,
      profiles: profileMapRef.current,
      avatarUrls: avatarUrlMapRef.current,
      stickers: stickersRef.current,
      ui: {
        activeSection: activeSectionRef.current,
        activeConversationId: activeConversationIdRef.current,
        activeContactUserId: activeContactUserIdRef.current,
        activeContactGroupId: activeContactGroupIdRef.current,
        contactListTab: contactListTabRef.current,
        contactDetailView: contactDetailViewRef.current,
      },
    });
  };

  const applyAccountCache = (accountKey: string): boolean => {
    const cache = loadChatAccountCache(accountKey);
    if (!cache) {
      return false;
    }
    const cachedAvatarUrls = cache.avatarUrls ?? {};
    const cachedGroups = cache.groups ?? {};
    const displayGroups = Object.fromEntries(
      Object.entries(cachedGroups).map(([groupId, group]) => [
        groupId,
        groupWithCachedAvatar(group, cachedAvatarUrls),
      ]),
    );
    const displayConversations = cache.conversations.map((conversation) =>
      conversationWithCachedGroupAvatar(
        conversation,
        displayGroups,
        cachedAvatarUrls,
      ),
    );
    avatarUrlMapRef.current = cachedAvatarUrls;
    groupMapRef.current = displayGroups;
    conversationsRef.current = displayConversations;
    setConversations(displayConversations);
    setMessages(cache.messages);
    setFriends(cache.friends);
    setFriendRequests(cache.friendRequests);
    setGroupMap(displayGroups);
    setGroupMembersMap(cache.groupMembers ?? {});
    setGroupRequests(cache.groupRequests ?? []);
    setMyProfile(cache.myProfile);
    setProfileMap(cache.profiles);
    setAvatarUrlMap(cachedAvatarUrls);
    setStickers(cache.stickers ?? []);
    const cachedSection = cache.ui.activeSection === "drive" ? "messages" : cache.ui.activeSection;
    setActiveSection(cachedSection);
    setActiveConversationId(
      displayConversations.some(
        (conversation) => conversation.id === cache.ui.activeConversationId,
      )
        ? cache.ui.activeConversationId
        : displayConversations[0]?.id ?? "",
    );
    const cachedContactUserId =
      cache.friends.some((friend) => friend.userId === cache.ui.activeContactUserId)
        ? cache.ui.activeContactUserId
        : null;
    const cachedContactGroupId =
      cache.ui.activeContactGroupId &&
      displayConversations.some(
        (conversation) =>
          conversation.kind === "group" &&
          conversation.groupId === cache.ui.activeContactGroupId,
      )
        ? cache.ui.activeContactGroupId
        : null;
    const cachedView = cache.ui.contactDetailView;
    setActiveContactUserId(cachedView === "group" ? null : cachedContactUserId);
    setActiveContactGroupId(cachedView === "group" ? cachedContactGroupId : null);
    setContactListTab(
      cachedView === "group" || cache.ui.contactListTab === "groups"
        ? "groups"
        : "friends",
    );
    setContactDetailView(
      (cachedView === "friend" && !cachedContactUserId) ||
        (cachedView === "group" && !cachedContactGroupId)
        ? "empty"
        : cachedView,
    );
    return true;
  };

  const clearChatMemory = () => {
    setDraft("");
    setHistoryExhaustedMap({});
    setMoreMenuOpen(false);
    setAddMenuOpen(false);
    setEmojiPanelOpen(false);
    setConversationMenu(null);
    setMessageMenu(null);
    setGroupMemberMenu(null);
    setRtcTestOpen(false);
    setQuotedMessage(null);
    setMultiSelectMode(false);
    setSelectedMessageIds([]);
    setForwardPicker(null);
    setEmojiPanelOpen(false);
    setStickerUploading(false);
    setCreateGroupOpen(false);
    setCreateGroupSearch("");
    setCreateGroupName("");
    setSelectedGroupMemberIds([]);
    setCreatingGroup(false);
    setCreateGroupError(null);
    setInviteGroupOpen(false);
    setInviteGroupSearch("");
    setSelectedInviteMemberIds([]);
    setInvitingGroup(false);
    setInviteGroupError(null);
    setInviteGroupNotice(null);
    setRemoveGroupOpen(false);
    setRemoveGroupSearch("");
    setSelectedRemoveMemberIds([]);
    setRemovingGroupMembers(false);
    setRemoveGroupError(null);
    setGroupRequests([]);
    setGroupSettingsOpen(false);
    setDirectSettingsOpen(false);
    setGroupSettingsView("main");
    setGroupOverviewHidden(false);
    setGroupMemberSearchOpen(false);
    setGroupSearch("");
    setGroupMap({});
    setGroupMembersMap({});
    setGroupLoadingMap({});
    setGroupTitleEditing(false);
    setGroupTitleDraft("");
    setGroupTitleSaving(false);
    setGroupEditing(false);
    setGroupEditDraft({
      name: "",
      avatarUrl: null,
      avatarObjectKey: null,
      description: "",
      announcement: "",
    });
    setGroupSaving(false);
    setGroupEditError(null);
    setGroupConfirm(null);
    setGroupActionBusy(false);
    setActiveSection("messages");
    setActiveContactGroupId(null);
    setContactListTab("friends");
    setConversations([]);
    setMessages([]);
    setActiveConversationId("");
    setMyProfile(null);
    setProfileMap({});
    setAvatarUrlMap({});
    setStickers([]);
    resetContacts();
  };

  const profileWithCachedAvatar = (profile: UserProfile): UserProfile => {
    if (!profile.avatarUrl && !profile.avatarObjectKey) {
      return profile;
    }
    const cachedUrl = avatarUrlMapRef.current[avatarCacheKey(profile)];
    return cachedUrl ? { ...profile, avatarUrl: cachedUrl } : profile;
  };

  const groupWithCachedAvatar = (
    group: ChatGroup,
    avatarUrls = avatarUrlMapRef.current,
  ): ChatGroup => {
    if (!group.avatarUrl && !group.avatarObjectKey) {
      return group;
    }
    const cachedUrl = avatarUrls[groupAvatarCacheKey(group)];
    return cachedUrl ? { ...group, avatarUrl: cachedUrl } : group;
  };

  const conversationWithCachedGroupAvatar = (
    conversation: ChatConversation,
    groups = groupMapRef.current,
    avatarUrls = avatarUrlMapRef.current,
  ): ChatConversation => {
    if (conversation.kind !== "group" || !conversation.groupId) {
      return conversation;
    }
    const knownGroup = groups[conversation.groupId];
    const cachedUrl =
      avatarUrls[
        groupAvatarCacheKey(
          knownGroup ?? {
            id: conversation.groupId,
            avatarObjectKey: conversation.groupAvatarObjectKey ?? null,
            avatarUrl:
              conversation.groupAvatarUrl || conversation.participant.avatarUrl || null,
          },
        )
      ];
    const avatarUrl = cachedUrl || groupDisplayAvatarUrl(knownGroup, conversation);
    if (
      conversation.groupAvatarUrl === avatarUrl &&
      conversation.participant.avatarUrl === avatarUrl
    ) {
      return conversation;
    }
    return {
      ...conversation,
      groupAvatarUrl: avatarUrl,
      groupAvatarObjectKey:
        knownGroup?.avatarObjectKey ?? conversation.groupAvatarObjectKey ?? null,
      participant: {
        ...conversation.participant,
        avatarUrl,
      },
    };
  };

  const conversationWithGroupAvatar = (
    conversation: ChatConversation,
    group: ChatGroup | null | undefined,
  ): ChatConversation =>
    conversationWithCachedGroupAvatar(
      conversation,
      group ? { ...groupMapRef.current, [group.id]: group } : groupMapRef.current,
    );

  const applyProfileToChatState = (profile: UserProfile) => {
    const displayProfile = profileWithCachedAvatar(profile);
    if (displayProfile.userId === currentUserIdRef.current) {
      setMyProfile((current) =>
        sameProfile(current, displayProfile) ? current : displayProfile,
      );
    } else {
      setProfileMap((current) =>
        sameProfile(current[displayProfile.userId], displayProfile)
          ? current
          : {
              ...current,
              [displayProfile.userId]: displayProfile,
            },
      );
    }
    setConversations((current) => {
      let changed = false;
      const next = current.map((conversation) => {
        const merged = mergeProfileIntoConversation(conversation, displayProfile);
        if (merged !== conversation) {
          changed = true;
        }
        return merged;
      });
      return changed ? next : current;
    });
    setFriends((current) =>
      updateProfileList(
        current,
        displayProfile,
        displayProfile.friendStatus === "friend",
      ),
    );
    setFriendRequests((current) => updateRequestProfiles(current, displayProfile));
    setGroupRequests((current) => updateGroupRequestProfiles(current, displayProfile));
  };

  const applyGroupToChatState = (
    group: ChatGroup,
    conversation?: ChatConversation | null,
  ): GroupProfileSnapshot => {
    const displayGroup = groupWithCachedAvatar(group);
    const knownConversation =
      conversation ??
      conversationsRef.current.find(
        (item) => item.kind === "group" && item.groupId === group.id,
      ) ??
      null;
    const displayConversation = knownConversation
      ? conversationWithGroupAvatar(knownConversation, displayGroup)
      : null;
    const fallbackConversation: ChatConversation = {
      id: group.conversationId,
      kind: "group",
      participant: {
        id: group.id,
        name: group.name,
        team: "",
        avatar: group.name.slice(0, 1),
        avatarUrl: displayGroup.avatarUrl ?? null,
        presence: "offline",
        presenceLabel: "",
        lastSeenLabel: "",
      },
      title: group.name,
      subtitle: "",
      timeLabel: "",
      unreadCount: 0,
      pinned: false,
      muted: false,
      currentUserId: currentUserIdRef.current,
      groupId: group.id,
      groupMemberCount: group.memberCount,
      groupAvatarUrl: displayGroup.avatarUrl ?? null,
      groupAvatarObjectKey: displayGroup.avatarObjectKey ?? null,
    };
    cacheAvatarForGroup(group, displayConversation ?? knownConversation ?? fallbackConversation);
    setGroupMap((current) =>
      sameGroup(current[group.id], displayGroup)
        ? current
        : {
            ...current,
            [group.id]: displayGroup,
          },
    );
    if (displayConversation) {
      setConversations((current) => upsertConversation(current, displayConversation));
    }
    const snapshot = groupSnapshotFromConversation(
      displayConversation ?? knownConversation ?? fallbackConversation,
      displayGroup,
    );
    setProfileCard((current) =>
      current?.kind === "group" && current.group.id === group.id
        ? {
            ...current,
            group: snapshot,
            membership: groupMembershipStateFor(group.id),
            loading: false,
            membersLoading: false,
            members:
              groupMembersMapRef.current[group.id] ?? current.members,
          }
        : current,
    );
    return snapshot;
  };

  const normalizeGroupRequestProfiles = (
    request: ChatGroupJoinRequest,
  ): ChatGroupJoinRequest => {
    cacheAvatarForProfile(request.applicantProfile);
    cacheAvatarForProfile(request.inviterProfile);
    cacheAvatarForProfile(request.handledByProfile);
    return {
      ...request,
      applicantProfile: request.applicantProfile
        ? profileWithCachedAvatar(request.applicantProfile)
        : request.applicantProfile,
      inviterProfile: request.inviterProfile
        ? profileWithCachedAvatar(request.inviterProfile)
        : request.inviterProfile,
      handledByProfile: request.handledByProfile
        ? profileWithCachedAvatar(request.handledByProfile)
        : request.handledByProfile,
    };
  };

  const cacheAvatarForProfile = (profile: UserProfile | null | undefined) => {
    const accountKey = activeAccountKeyRef.current;
    if (!accountKey || (!profile?.avatarUrl && !profile?.avatarObjectKey)) {
      return;
    }
    const key = avatarCacheKey(profile);
    if (avatarUrlMapRef.current[key]) {
      return;
    }
    void cacheProfileAvatar({
      accountKey,
      avatarKey: profile.avatarObjectKey || String(profile.userId),
      avatarUrl: profile.avatarUrl || profile.avatarObjectKey || "",
    })
      .then((localUrl) => {
        if (!localUrl || activeAccountKeyRef.current !== accountKey) {
          return;
        }
        setAvatarUrlMap((current) => {
          if (current[key] === localUrl) {
            return current;
          }
          return { ...current, [key]: localUrl };
        });
        applyProfileToChatState({ ...profile, avatarUrl: localUrl });
      })
      .catch(() => undefined);
  };

  const cacheAvatarForGroup = (
    group: ChatGroup | null | undefined,
    conversation?: ChatConversation | null,
  ) => {
    const accountKey = activeAccountKeyRef.current;
    const groupId = group?.id || conversation?.groupId || null;
    const source =
      group?.avatarUrl ||
      group?.avatarObjectKey ||
      conversation?.groupAvatarObjectKey ||
      conversation?.groupAvatarUrl ||
      conversation?.participant.avatarUrl ||
      "";
    if (!accountKey || !groupId || !source) {
      return;
    }
    const cacheInput =
      group ??
      ({
        id: groupId,
        avatarObjectKey: conversation?.groupAvatarObjectKey ?? null,
        avatarUrl: source,
      } as Pick<ChatGroup, "id" | "avatarUrl" | "avatarObjectKey">);
    const key = groupAvatarCacheKey(cacheInput);
    if (avatarUrlMapRef.current[key]) {
      return;
    }
    void cacheProfileAvatar({
      accountKey,
      avatarKey:
        group?.avatarObjectKey ||
        conversation?.groupAvatarObjectKey ||
        stableAvatarReference(group?.avatarUrl || conversation?.groupAvatarUrl || source) ||
        `group-${groupId}`,
      avatarUrl: source,
    })
      .then((localUrl) => {
        if (!localUrl || activeAccountKeyRef.current !== accountKey) {
          return;
        }
        avatarUrlMapRef.current = {
          ...avatarUrlMapRef.current,
          [key]: localUrl,
        };
        setAvatarUrlMap((current) => {
          if (current[key] === localUrl) {
            return current;
          }
          return { ...current, [key]: localUrl };
        });
        setGroupMap((current) => {
          const currentGroup = current[groupId];
          if (!currentGroup || currentGroup.avatarUrl === localUrl) {
            return current;
          }
          return {
            ...current,
            [groupId]: { ...currentGroup, avatarUrl: localUrl },
          };
        });
        setConversations((current) =>
          current.map((item) =>
            item.kind === "group" && item.groupId === groupId
              ? {
                  ...item,
                  groupAvatarUrl: localUrl,
                  participant: { ...item.participant, avatarUrl: localUrl },
                }
              : item,
          ),
        );
      })
      .catch(() => undefined);
  };

  const refreshMyProfile = async (
    refreshId = chatRefreshSeqRef.current,
    keepCurrentOnError = false,
  ) => {
    try {
      const next = await loadMyProfile();
      if (refreshId === chatRefreshSeqRef.current) {
        const displayProfile = profileWithCachedAvatar(next);
        setMyProfile((current) =>
          sameProfile(current, displayProfile) ? current : displayProfile,
        );
        cacheAvatarForProfile(next);
      }
    } catch {
      if (refreshId === chatRefreshSeqRef.current && !keepCurrentOnError) {
        setMyProfile(null);
      }
    }
  };

  const refreshConversationProfiles = async (
    sourceConversations: ChatConversation[],
    refreshId = chatRefreshSeqRef.current,
  ) => {
    const userIds = Array.from(
      new Set(
        sourceConversations
          .filter((conversation) => conversation.kind === "direct")
          .map((conversation) => Number(conversation.participant.id))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    );
    if (userIds.length === 0) {
      return;
    }
    const loaded = await Promise.all(
      userIds.map(async (userId) => {
        try {
          return await loadUserProfile(userId);
        } catch {
          return null;
        }
      }),
    );
    if (refreshId !== chatRefreshSeqRef.current) {
      return;
    }
    setProfileMap((current) => {
      let changed = false;
      const next = { ...current };
      loaded.forEach((profile) => {
        if (!profile) {
          return;
        }
        const displayProfile = profileWithCachedAvatar(profile);
        cacheAvatarForProfile(profile);
        if (!sameProfile(current[displayProfile.userId], displayProfile)) {
          next[displayProfile.userId] = displayProfile;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  };

  const refreshConversationGroups = async (
    sourceConversations: ChatConversation[],
    refreshId = chatRefreshSeqRef.current,
  ) => {
    const groupIds = Array.from(
      new Set(
        sourceConversations
          .filter((conversation) => conversation.kind === "group" && conversation.groupId)
          .filter((conversation) => {
            const groupId = conversation.groupId as string;
            const knownGroup = groupMapRef.current[groupId];
            const displayAvatarUrl = groupDisplayAvatarUrl(knownGroup, conversation);
            return (
              !knownGroup ||
              (!knownGroup.avatarObjectKey &&
                (!displayAvatarUrl ||
                  Boolean(
                    conversation.groupAvatarUrl &&
                      !isLocalAvatarUrl(conversation.groupAvatarUrl),
                  )))
            );
          })
          .map((conversation) => conversation.groupId as string),
      ),
    );
    if (groupIds.length === 0) {
      return;
    }
    const loaded = await Promise.all(
      groupIds.map(async (groupId) => {
        try {
          return await loadChatGroup(groupId);
        } catch {
          return null;
        }
      }),
    );
    if (refreshId !== chatRefreshSeqRef.current) {
      return;
    }
    const loadedGroups = loaded.filter(Boolean) as {
      group: ChatGroup;
      conversation: ChatConversation;
    }[];
    if (loadedGroups.length === 0) {
      return;
    }
    setGroupMap((current) => {
      let changed = false;
      const next = { ...current };
      loadedGroups.forEach(({ group }) => {
        const displayGroup = groupWithCachedAvatar(group);
        if (!sameGroup(next[group.id], displayGroup)) {
          next[group.id] = displayGroup;
          changed = true;
        }
      });
      return changed ? next : current;
    });
    setConversations((current) => {
      let next = current;
      loadedGroups.forEach(({ group, conversation }) => {
        const displayGroup = groupWithCachedAvatar(group);
        const displayConversation = conversationWithGroupAvatar(
          conversation,
          displayGroup,
        );
        next = upsertConversation(next, displayConversation);
        cacheAvatarForGroup(group, conversation);
      });
      return next;
    });
  };

  const resetContacts = () => {
    contactsRefreshSeqRef.current += 1;
    setFriends([]);
    setFriendRequests([]);
    setContactsLoading(false);
    setContactsError(null);
    setActiveContactUserId(null);
    setActiveContactGroupId(null);
    setContactListTab("friends");
    setContactDetailView("empty");
  };

  const refreshContacts = async ({
    refreshId,
    silent = false,
  }: {
    refreshId?: number;
    silent?: boolean;
  } = {}) => {
    const nextRefreshId = refreshId ?? contactsRefreshSeqRef.current + 1;
    contactsRefreshSeqRef.current = nextRefreshId;
    if (!silent) {
      setContactsLoading(true);
    }
    setContactsError(null);
    try {
      const [nextFriends, nextRequests, nextGroupRequests] = await Promise.all([
        listFriends(),
        listFriendRequests(),
        loadChatGroupNotifications(),
      ]);
      if (nextRefreshId !== contactsRefreshSeqRef.current) {
        return;
      }
      const displayFriends = nextFriends.map((profile) => {
        cacheAvatarForProfile(profile);
        return profileWithCachedAvatar(profile);
      });
      const displayRequests = nextRequests.map((request) => {
        cacheAvatarForProfile(request.fromProfile);
        cacheAvatarForProfile(request.toProfile);
        return {
          ...request,
          fromProfile: request.fromProfile
            ? profileWithCachedAvatar(request.fromProfile)
            : request.fromProfile,
          toProfile: request.toProfile
            ? profileWithCachedAvatar(request.toProfile)
            : request.toProfile,
        };
      });
      const displayGroupRequests = nextGroupRequests.map(normalizeGroupRequestProfiles);
      setFriends(displayFriends);
      setFriendRequests(displayRequests);
      setGroupRequests(displayGroupRequests);
      setProfileMap((current) => {
        let changed = false;
        const next = { ...current };
        displayFriends.forEach((profile) => {
          if (!sameProfile(next[profile.userId], profile)) {
            next[profile.userId] = profile;
            changed = true;
          }
        });
        displayRequests.forEach((request) => {
          [request.fromProfile, request.toProfile].forEach((profile) => {
            if (profile && !sameProfile(next[profile.userId], profile)) {
              next[profile.userId] = profile;
              changed = true;
            }
          });
        });
        displayGroupRequests.forEach((request) => {
          [
            request.applicantProfile,
            request.inviterProfile,
            request.handledByProfile,
          ].forEach((profile) => {
            if (profile && !sameProfile(next[profile.userId], profile)) {
              next[profile.userId] = profile;
              changed = true;
            }
          });
        });
        return changed ? next : current;
      });
      setActiveContactUserId((current) => {
        if (
          current &&
          !displayFriends.some((friend) => friend.userId === current)
        ) {
          setContactDetailView((view) => (view === "friend" ? "empty" : view));
          return null;
        }
        return current;
      });
    } catch (error) {
      if (nextRefreshId === contactsRefreshSeqRef.current) {
        setContactsError(String(error));
      }
    } finally {
      if (nextRefreshId === contactsRefreshSeqRef.current) {
        setContactsLoading(false);
      }
    }
  };

  const refreshConversations = async ({
    clearMessages = false,
    refreshId = chatRefreshSeqRef.current,
  }: {
    clearMessages?: boolean;
    refreshId?: number;
  } = {}) => {
    const remoteConversations = await loadChatConversations();
    if (refreshId !== chatRefreshSeqRef.current) {
      return [];
    }
    const displayConversations = remoteConversations.map((conversation) => {
      if (conversation.kind === "group") {
        cacheAvatarForGroup(null, conversation);
      }
      return conversationWithCachedGroupAvatar(conversation);
    });
    setConversations(displayConversations);
    setActiveConversationId((current) =>
      displayConversations.some((item) => item.id === current)
        ? current
        : displayConversations[0]?.id ?? "",
    );
    if (clearMessages) {
      setMessages([]);
    }
    setDataSource({ loading: false, live: true, error: null });
    void refreshConversationProfiles(displayConversations, refreshId);
    void refreshConversationGroups(displayConversations, refreshId);
    return displayConversations;
  };

  const refreshChatForCurrentAccount = async (
    knownState?: LocalAccountState | null,
  ) => {
    persistCurrentAccountCache();
    activeAccountKeyRef.current = null;
    void stopChatRealtime().catch(() => undefined);
    const refreshId = chatRefreshSeqRef.current + 1;
    chatRefreshSeqRef.current = refreshId;
    setDataSource({ loading: true, live: false, error: null });
    clearChatMemory();
    try {
      const state =
        knownState ??
        (await invoke<LocalAccountState>("load_local_account_state"));
      if (refreshId !== chatRefreshSeqRef.current) {
        return;
      }
      const accountKey = chatAccountKeyFromState(state);
      setAccountState(state);
      if (!state.loggedIn || !accountKey) {
        setConversations(mockConversations);
        setMessages(mockMessages);
        setActiveConversationId(mockConversations[0]?.id ?? "");
        setMyProfile(null);
        setProfileMap({});
        setDataSource({
          loading: false,
          live: false,
          error: "未登录，当前显示预览数据",
        });
        return;
      }
      activeAccountKeyRef.current = accountKey;
      const restoredFromCache = applyAccountCache(accountKey);
      setDataSource({ loading: true, live: false, error: null });
      await refreshMyProfile(refreshId, restoredFromCache);
      await refreshConversations({
        clearMessages: !restoredFromCache,
        refreshId,
      });
      await refreshContacts({ silent: true });
    } catch (error) {
      if (refreshId !== chatRefreshSeqRef.current) {
        return;
      }
      setDataSource({
        loading: false,
        live: false,
        error: String(error),
      });
    }
  };

  useEffect(() => {
    void refreshChatForCurrentAccount();
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenTransferEvents: (() => void) | null = null;
    void listenForChatTransferEvents((event) => {
      if (!disposed) {
        applyTransferEvent(event);
      }
    })
      .then((unlisten) => {
        unlistenTransferEvents = unlisten;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlistenTransferEvents?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenFileDropEvents: (() => void) | null = null;
    const handleDrop = async (event: TauriDragDropEvent) => {
      if (disposed) {
        return;
      }
      if (event.type === "enter" || event.type === "over") {
        if (activeConversationIdRef.current) {
          setChatDragActive(true);
        }
        return;
      }
      if (event.type === "leave") {
        setChatDragActive(false);
        return;
      }
      if (event.type !== "drop") {
        return;
      }
      setChatDragActive(false);
      if (!activeConversationIdRef.current) {
        setDataSource((current) => ({ ...current, error: "请先选择一个会话" }));
        return;
      }
      if (event.paths.length === 0) {
        return;
      }
      try {
        const files = await inspectChatUploadFiles(event.paths);
        if (!disposed && files.length > 0) {
          await sendLocalUploadFilesRef.current(files);
        }
      } catch (error) {
        if (!disposed) {
          setDataSource((current) => ({
            ...current,
            error: friendlyError(String(error)),
          }));
        }
      }
    };
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        void handleDrop(event.payload);
      })
      .then((unlisten) => {
        unlistenFileDropEvents = unlisten;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlistenFileDropEvents?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenAuth: (() => void) | null = null;
    let unlistenProfile: (() => void) | null = null;
    let unlistenFriendRequestSent: (() => void) | null = null;
    let unlistenOpenConversation: (() => void) | null = null;
    let unlistenForwardMessage: (() => void) | null = null;
    let unlistenQuoteMessage: (() => void) | null = null;
    let unlistenLocateMessage: (() => void) | null = null;
    async function bind() {
      unlistenAuth = await listen<LocalAccountState>(
        AUTH_STATE_CHANGED_EVENT,
        (event) => {
          if (disposed) {
            return;
          }
          void refreshChatForCurrentAccount(event.payload);
        },
      );
      unlistenProfile = await listen<{ profile?: UserProfile }>(
        PROFILE_UPDATED_EVENT,
        (event) => {
          const profile = event.payload.profile;
          if (disposed || !profile) {
            return;
          }
          const profileIsMe = profile.userId === currentUserIdRef.current;
          const displayProfile = profileWithCachedAvatar(profile);
          const currentProfile = profileIsMe
            ? myProfileRef.current
            : profileMapRef.current[displayProfile.userId];
          if (!sameProfile(currentProfile, displayProfile)) {
            applyProfileToChatState(displayProfile);
          }
          cacheAvatarForProfile(profile);
        },
      );
      unlistenFriendRequestSent = await listen<{
        userId?: number;
        request?: FriendRequest;
        profile?: UserProfile;
      }>(FRIEND_REQUEST_SENT_EVENT, (event) => {
        if (disposed) {
          return;
        }
        if (event.payload.profile) {
          applyNewFriendProfile(event.payload.profile);
          void refreshContacts({ silent: true }).catch(() => undefined);
          return;
        }
        const request = event.payload.request;
        if (request) {
          cacheAvatarForProfile(request.fromProfile);
          cacheAvatarForProfile(request.toProfile);
          const displayRequest = {
            ...request,
            fromProfile: request.fromProfile
              ? profileWithCachedAvatar(request.fromProfile)
              : request.fromProfile,
            toProfile: request.toProfile
              ? profileWithCachedAvatar(request.toProfile)
              : request.toProfile,
          };
          setFriendRequests((current) =>
            upsertFriendRequest(current, displayRequest),
          );
          [displayRequest.fromProfile, displayRequest.toProfile].forEach((profile) => {
            if (!profile) {
              return;
            }
            setProfileMap((current) =>
              sameProfile(current[profile.userId], profile)
                ? current
                : { ...current, [profile.userId]: profile },
            );
          });
        } else {
          void refreshContacts({ silent: true }).catch(() => undefined);
        }
      });
      unlistenOpenConversation = await listen<{
        userId?: number;
        conversationId?: string;
      }>(
        CHAT_OPEN_CONVERSATION_EVENT,
        (event) => {
          if (disposed) {
            return;
          }
          if (event.payload.conversationId) {
            const knownConversation = conversationsRef.current.some(
              (conversation) =>
                conversation.id === event.payload.conversationId,
            );
            if (knownConversation) {
              selectConversation(event.payload.conversationId);
              return;
            }
            void refreshConversations({ clearMessages: false })
              .then((items) => {
                if (
                  items.some(
                    (conversation) =>
                      conversation.id === event.payload.conversationId,
                  )
                ) {
                  setActiveSection("messages");
                  setActiveConversationId(event.payload.conversationId!);
                }
              })
              .catch(() => undefined);
            if (event.payload.userId) {
              void openDirectConversation(event.payload.userId);
              return;
            }
            return;
          }
          if (event.payload.userId) {
            void openDirectConversation(event.payload.userId);
          }
        },
      );
      unlistenForwardMessage = await listen<{ messageId?: string }>(
        CHAT_FORWARD_MESSAGE_EVENT,
        (event) => {
          if (disposed || !event.payload.messageId) {
            return;
          }
          openForwardPicker([event.payload.messageId]);
        },
      );
      unlistenQuoteMessage = await listen<{
        conversationId?: string;
        messageId?: string;
        quoteMeta?: QuoteMeta | null;
        senderLabel?: string;
        preview?: string;
      }>(CHAT_QUOTE_MESSAGE_EVENT, (event) => {
        if (
          disposed ||
          !event.payload.conversationId ||
          !event.payload.messageId
        ) {
          return;
        }
        selectConversation(event.payload.conversationId);
        setQuotedMessage(
          event.payload.quoteMeta ?? {
            quotedMessageId: event.payload.messageId,
            quotedConversationId: event.payload.conversationId,
            quotedSenderName: event.payload.senderLabel || "对方",
            quotedMessageType: "text",
            previewText: event.payload.preview || "聊天记录",
          },
        );
        window.requestAnimationFrame(() => {
          draftInputRef.current?.focus();
        });
      });
      unlistenLocateMessage = await listen<{
        conversationId?: string;
        messageId?: string;
        conversationSeq?: number | null;
      }>(CHAT_LOCATE_MESSAGE_EVENT, (event) => {
        if (
          disposed ||
          !event.payload.conversationId ||
          !event.payload.messageId
        ) {
          return;
        }
        void locateMessageFromHistory(
          event.payload.conversationId,
          event.payload.messageId,
          event.payload.conversationSeq ?? null,
        );
      });
    }
    void bind();
    return () => {
      disposed = true;
      unlistenAuth?.();
      unlistenProfile?.();
      unlistenFriendRequestSent?.();
      unlistenOpenConversation?.();
      unlistenForwardMessage?.();
      unlistenQuoteMessage?.();
      unlistenLocateMessage?.();
    };
  }, []);

  useEffect(() => {
    if (!accountState?.loggedIn) {
      return;
    }
    let unlistenMessages: (() => void) | null = null;
    let unlistenDeletedMessages: (() => void) | null = null;
    let unlistenRevokedMessages: (() => void) | null = null;
    let unlistenFriendEvents: (() => void) | null = null;
    let unlistenGroupEvents: (() => void) | null = null;
    let disposed = false;
    const realtimeRefreshId = chatRefreshSeqRef.current;

    async function connectRealtime() {
      try {
        unlistenMessages = await listenForNewChatMessages((message) => {
          if (realtimeRefreshId !== chatRefreshSeqRef.current) {
            return;
          }
          const senderUserId = currentUserIdRef.current;
          const normalizedMessage =
            senderUserId !== null && message.senderId === senderUserId
              ? { ...message, direction: "outgoing" as const }
              : { ...message, direction: "incoming" as const };
          setMessages((current) => {
            if (current.some((item) => item.id === normalizedMessage.id)) {
              return current;
            }
            return mergeMessages(current, [
              withRememberedLocalMediaPath(
                normalizedMessage,
                sentLocalMediaPathRef.current,
              ),
            ]);
          });
          const knownConversation = conversationsRef.current.some(
            (conversation) =>
              conversation.id === normalizedMessage.conversationId,
          );
          setConversations((current) =>
            current.map((conversation) =>
              conversation.id === normalizedMessage.conversationId
                ? {
                    ...conversation,
                    subtitle: messagePreview(normalizedMessage),
                    timeLabel:
                      normalizedMessage.timeLabel || conversation.timeLabel,
                    unreadCount:
                      conversation.id === activeConversationIdRef.current ||
                      normalizedMessage.direction === "outgoing"
                        ? 0
                        : conversation.unreadCount + 1,
                  }
                : conversation,
            ),
          );
          if (!knownConversation) {
            void refreshConversations({ clearMessages: false }).catch(
              () => undefined,
            );
          }
        });
        unlistenRevokedMessages = await listenForRevokedChatMessages((message) => {
          if (realtimeRefreshId !== chatRefreshSeqRef.current) {
            return;
          }
          applyRevokedMessage(message);
        });
        unlistenDeletedMessages = await listenForDeletedChatMessages((event) => {
          if (realtimeRefreshId !== chatRefreshSeqRef.current) {
            return;
          }
          setMessages((current) =>
            current.filter((message) => message.id !== event.messageId),
          );
        });
        unlistenFriendEvents = await listenForFriendRequestEvents((friendEvent) => {
          if (realtimeRefreshId !== chatRefreshSeqRef.current) {
            return;
          }
          applyFriendRealtimeEvent(friendEvent.event, friendEvent.request);
        });
        unlistenGroupEvents = await listenForGroupEvents((groupEvent) => {
          if (realtimeRefreshId !== chatRefreshSeqRef.current) {
            return;
          }
          if (
            groupEvent.event === "group.created" ||
            groupEvent.event === "group.updated" ||
            groupEvent.event === "group.announcement.updated" ||
            groupEvent.event === "group.member.added" ||
            groupEvent.event === "group.member.role_changed"
          ) {
            if (groupEvent.group) {
              const displayGroup = groupWithCachedAvatar(groupEvent.group as ChatGroup);
              cacheAvatarForGroup(displayGroup, groupEvent.conversation ?? null);
              setGroupMap((current) => ({
                ...current,
                [displayGroup.id]: displayGroup,
              }));
            }
            if (groupEvent.conversation) {
              const displayGroup = groupEvent.group
                ? groupWithCachedAvatar(groupEvent.group as ChatGroup)
                : groupEvent.conversation.groupId
                  ? groupMapRef.current[groupEvent.conversation.groupId] ?? null
                  : null;
              const displayConversation = conversationWithGroupAvatar(
                groupEvent.conversation as ChatConversation,
                displayGroup,
              );
              cacheAvatarForGroup(groupEvent.group ?? null, displayConversation);
              setConversations((current) =>
                upsertConversation(current, displayConversation),
              );
              if (
                displayConversation.id === activeConversationIdRef.current &&
                displayConversation.kind === "group"
              ) {
                void refreshActiveGroupMembers(displayConversation).catch(
                  () => undefined,
                );
              }
              return;
            }
            void refreshConversations({ clearMessages: false }).catch(
              () => undefined,
            );
          }
          if (
            (groupEvent.event === "group.join_request.created" ||
              groupEvent.event === "group.join_request.handled") &&
            groupEvent.request
          ) {
            applyGroupRealtimeEvent(groupEvent.event, groupEvent.request);
          }
          if (
            groupEvent.event === "group.member.removed" ||
            groupEvent.event === "group.dissolved"
          ) {
            void refreshConversations({ clearMessages: false }).catch(
              () => undefined,
            );
          }
        });
        await startChatRealtime();
      } catch (error) {
        if (!disposed && realtimeRefreshId === chatRefreshSeqRef.current) {
          setDataSource((current) => ({ ...current, error: String(error) }));
        }
      }
    }

    void connectRealtime();
    return () => {
      disposed = true;
      unlistenMessages?.();
      unlistenDeletedMessages?.();
      unlistenRevokedMessages?.();
      unlistenFriendEvents?.();
      unlistenGroupEvents?.();
      void stopChatRealtime();
    };
  }, [accountState?.ownerUserId, currentUserId]);

  const sortedConversations = useMemo(
    () =>
      [...conversations].sort((left, right) => {
        if (left.pinned !== right.pinned) {
          return left.pinned ? -1 : 1;
        }

        return 0;
      }),
    [conversations],
  );
  const activeConversation =
    conversations.find((item) => item.id === activeConversationId) ??
    sortedConversations[0];
  const displayedActiveConversation = activeConversation
    ? withProfile(activeConversation, profileMap)
    : activeConversation;
  const activeGroupId =
    displayedActiveConversation?.kind === "group"
      ? displayedActiveConversation.groupId ?? null
      : null;
  const activeGroup = activeGroupId ? groupMap[activeGroupId] ?? null : null;
  const activeGroupMembers = activeGroupId
    ? groupMembersMap[activeGroupId] ?? []
    : [];
  const activeGroupLoading = activeGroupId
    ? Boolean(groupLoadingMap[activeGroupId])
    : false;
  const rtcDefaultChannelId = activeGroupId || displayedActiveConversation?.id || "rtc_test_001";
  const activeMessages = messages.filter(
    (message) => message.conversationId === activeConversation?.id,
  ).sort(compareMessages);
  const totalUnreadCount = conversations.reduce(
    (total, conversation) => total + conversation.unreadCount,
    0,
  );

  const scheduleScrollToLatestSelfMessage = (conversationId: string) => {
    pendingSelfMessageScrollRef.current = conversationId;
  };

  const scrollMessagesToBottomAfterSelfSend = () => {
    const element = messageScrollRef.current;
    if (!element) {
      return;
    }
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    if (maxScrollTop <= 0) {
      return;
    }

    const distance = Math.abs(maxScrollTop - element.scrollTop);
    if (distance > element.clientHeight * 1.2) {
      element.scrollTop = Math.max(0, maxScrollTop - 28);
      window.setTimeout(() => {
        messageScrollRef.current?.scrollTo({
          top: messageScrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 16);
      return;
    }

    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  };

  useEffect(() => {
    if (
      !activeConversation?.id ||
      pendingSelfMessageScrollRef.current !== activeConversation.id
    ) {
      return;
    }
    pendingSelfMessageScrollRef.current = null;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(scrollMessagesToBottomAfterSelfSend);
    });
  }, [activeConversation?.id, activeMessages.length]);

  useEffect(() => {
    if (!dataSource.live || !activeConversation?.id) {
      return;
    }

    const refreshId = chatRefreshSeqRef.current;
    let cancelled = false;
    async function refreshMessages() {
      try {
        const remoteMessages = await loadChatMessages(activeConversation.id);
        if (!cancelled && refreshId === chatRefreshSeqRef.current) {
          setMessages((current) =>
            mergeMessages(
              current,
              remoteMessages.map((message) =>
                withRememberedLocalMediaPath(message, sentLocalMediaPathRef.current),
              ),
            ),
          );
          setHistoryExhaustedMap((current) => ({
            ...current,
            [activeConversation.id]: remoteMessages.length < 50,
          }));
          const latestSeq = Math.max(
            0,
            ...remoteMessages.map((message) => message.conversationSeq ?? 0),
          );
          if (latestSeq > 0) {
            void markConversationRead(activeConversation.id, latestSeq).catch(
              (error) => {
                setDataSource((current) => ({
                  ...current,
                  error: String(error),
                }));
              },
            );
          }
        }
      } catch (error) {
        if (!cancelled && refreshId === chatRefreshSeqRef.current) {
          setDataSource((current) => ({ ...current, error: String(error) }));
        }
      }
    }

    void refreshMessages();
    return () => {
      cancelled = true;
    };
  }, [activeConversation?.id, dataSource.live]);

  useEffect(() => {
    if (!dataSource.live || !activeConversation?.id) {
      return;
    }
    void refreshActiveGroupMembers(activeConversation).catch(() => undefined);
  }, [activeConversation?.id, dataSource.live]);


  const closeContextMenus = () => {
    setMoreMenuOpen(false);
    setAddMenuOpen(false);
    setScreenshotMenuOpen(false);
    setConversationMenu(null);
    setMessageMenu(null);
    setGroupMemberMenu(null);
  };

  const clearProfileCardTimers = () => {
    if (hoverProfileShowTimerRef.current !== null) {
      window.clearTimeout(hoverProfileShowTimerRef.current);
      hoverProfileShowTimerRef.current = null;
    }
    if (hoverProfileHideTimerRef.current !== null) {
      window.clearTimeout(hoverProfileHideTimerRef.current);
      hoverProfileHideTimerRef.current = null;
    }
  };

  const anchorFromElement = (element: HTMLElement): ProfileCardAnchor => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  };

  const closeProfileCard = () => {
    clearProfileCardTimers();
    setProfileCard(null);
  };

  const scheduleProfileCardHide = () => {
    if (hoverProfileShowTimerRef.current !== null) {
      window.clearTimeout(hoverProfileShowTimerRef.current);
      hoverProfileShowTimerRef.current = null;
    }
    if (hoverProfileHideTimerRef.current !== null) {
      window.clearTimeout(hoverProfileHideTimerRef.current);
    }
    hoverProfileHideTimerRef.current = window.setTimeout(() => {
      setProfileCard((current) => (current?.mode === "hover" ? null : current));
      hoverProfileHideTimerRef.current = null;
    }, 150);
  };

  const keepProfileCardOpen = () => {
    if (hoverProfileHideTimerRef.current !== null) {
      window.clearTimeout(hoverProfileHideTimerRef.current);
      hoverProfileHideTimerRef.current = null;
    }
  };

  const friendProfileFromKnownState = (
    userId: number,
    fallback?: Partial<UserProfile> | null,
  ): UserProfile => {
    if (userId === currentUserIdRef.current && myProfileRef.current) {
      return myProfileRef.current;
    }
    return (
      profileMapRef.current[userId] ??
      friendsRef.current.find((friend) => friend.userId === userId) ??
      ({
        userId,
        nickname: fallback?.nickname || `用户${userId}`,
        avatarUrl: fallback?.avatarUrl ?? null,
        avatarObjectKey: fallback?.avatarObjectKey ?? null,
        bio: fallback?.bio ?? "",
        accountType: fallback?.accountType ?? "normal",
        classNo: fallback?.classNo ?? null,
        online: false,
        friendStatus:
          userId === currentUserIdRef.current ? "self" : fallback?.friendStatus ?? "unknown",
      } as UserProfile)
    );
  };

  const hydrateFriendProfileCard = (userId: number) => {
    void loadUserProfile(userId)
      .then((profile) => {
        cacheAvatarForProfile(profile);
        const displayProfile = profileWithCachedAvatar(profile);
        applyProfileToChatState(displayProfile);
        setProfileCard((current) =>
          current?.kind === "friend" && current.profile.userId === userId
            ? { ...current, profile: displayProfile }
            : current,
        );
      })
      .catch(() => undefined);
  };

  const showFriendProfileCard = (
    userId: number,
    anchor: ProfileCardAnchor | null,
    mode: ProfileCardMode,
    fallback?: Partial<UserProfile> | null,
  ) => {
    if (!Number.isInteger(userId) || userId <= 0) {
      return;
    }
    const profile = friendProfileFromKnownState(userId, fallback);
    setProfileCard({ kind: "friend", mode, anchor, profile });
    hydrateFriendProfileCard(userId);
  };

  const scheduleFriendProfileCard = (
    userId: number,
    element: HTMLElement,
    fallback?: Partial<UserProfile> | null,
  ) => {
    clearProfileCardTimers();
    const anchor = anchorFromElement(element);
    hoverProfileShowTimerRef.current = window.setTimeout(() => {
      showFriendProfileCard(userId, anchor, "hover", fallback);
      hoverProfileShowTimerRef.current = null;
    }, 300);
  };

  const syncPinnedGroupProfileCardState = (
    groupId: string,
    patch?: Partial<
      Extract<NonNullable<ProfileCardState>, { kind: "group" }>
    >,
  ) => {
    setProfileCard((current) => {
      if (current?.kind !== "group" || current.group.id !== groupId) {
        return current;
      }
      return {
        ...current,
        membership: groupMembershipStateFor(groupId),
        loading: Boolean(groupLoadingMapRef.current[groupId]),
        membersLoading:
          patch?.membersLoading ?? current.membersLoading,
        members: groupMembersMapRef.current[groupId] ?? current.members,
        ...patch,
      };
    });
  };

  const hydrateGroupProfileCard = (groupId: string) => {
    if (!groupId) {
      return;
    }
    syncPinnedGroupProfileCardState(groupId, {
      loading: true,
      membersLoading: groupMembershipStateFor(groupId) === "joined",
    });
    void loadChatGroup(groupId)
      .then(async ({ group, conversation }) => {
        applyGroupToChatState(group, conversation);
        const joined = isJoinedGroup(groupId);
        if (!joined) {
          syncPinnedGroupProfileCardState(groupId, {
            loading: false,
            membersLoading: false,
            membership: groupMembershipStateFor(groupId),
            members: [],
          });
          return;
        }
        await refreshActiveGroupMembers(conversation);
        syncPinnedGroupProfileCardState(groupId, {
          loading: false,
          membersLoading: false,
          membership: "joined",
          members: groupMembersMapRef.current[groupId] ?? [],
        });
      })
      .catch(() => {
        syncPinnedGroupProfileCardState(groupId, {
          loading: false,
          membersLoading: false,
          membership: groupMembershipStateFor(groupId),
        });
      });
  };

  const groupSnapshotFromConversation = (
    conversation: ChatConversation,
    group?: ChatGroup | null,
  ): GroupProfileSnapshot => {
    const groupId = group?.id || conversation.groupId || conversation.id;
    const name = group?.name || conversation.title || "群聊";
    return {
      id: groupId,
      groupNo: group?.groupNo ?? null,
      conversationId: conversation.id,
      name,
      avatarUrl: groupDisplayAvatarUrl(group, conversation),
      avatarObjectKey: group?.avatarObjectKey ?? null,
      description: group?.description ?? null,
      announcement: group?.announcement ?? null,
      memberCount: group?.memberCount ?? conversation.groupMemberCount ?? null,
    };
  };

  const isJoinedGroup = (groupId: string): boolean =>
    conversationsRef.current.some(
      (conversation) => conversation.kind === "group" && conversation.groupId === groupId,
    );

  const pendingGroupRequestFor = (groupId: string): ChatGroupJoinRequest | null =>
    groupRequestsRef.current.find(
      (request) =>
        request.groupId === groupId &&
        isPendingGroupRequest(request) &&
        request.applicantUserId === currentUserIdRef.current,
    ) ?? null;

  const groupMembershipStateFor = (groupId: string): GroupMembershipState => {
    if (isJoinedGroup(groupId)) {
      return "joined";
    }
    return pendingGroupRequestFor(groupId) ? "pending" : "not_joined";
  };

  const showGroupProfileCard = (
    group: GroupProfileSnapshot,
    anchor: ProfileCardAnchor | null,
    mode: ProfileCardMode,
  ) => {
    const groupId = group.id;
    setProfileCard({
      kind: "group",
      mode,
      anchor,
      group,
      membership: groupMembershipStateFor(groupId),
      loading: true,
      membersLoading: false,
      members: groupMembersMapRef.current[groupId] ?? [],
    });
    hydrateGroupProfileCard(groupId);
  };

  const scheduleGroupProfileCard = (
    group: GroupProfileSnapshot,
    element: HTMLElement,
  ) => {
    clearProfileCardTimers();
    const anchor = anchorFromElement(element);
    hoverProfileShowTimerRef.current = window.setTimeout(() => {
      showGroupProfileCard(group, anchor, "hover");
      hoverProfileShowTimerRef.current = null;
    }, 300);
  };

  useEffect(() => {
    if (!profileCard) {
      return;
    }
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (
        target.closest(".profile-hover-card") ||
        target.closest(".card-share-dialog") ||
        target.closest(".avatar-hover-anchor") ||
        target.closest(".message-card-preview")
      ) {
        return;
      }
      closeProfileCard();
    };
    const closeOnScroll = () => {
      setProfileCard((current) => (current?.mode === "hover" ? null : current));
    };
    window.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [profileCard]);

  useEffect(() => {
    setProfileCard((current) => (current?.mode === "hover" ? null : current));
  }, [activeConversationId, activeSection, contactListTab]);

  const startChatListResize = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    closeContextMenus();

    const startX = event.clientX;
    const startWidth = chatListWidth;
    const shellRect = chatShellRef.current?.getBoundingClientRect();
    const navWidth =
      chatShellRef.current
        ?.querySelector(".chat-nav")
        ?.getBoundingClientRect().width ?? 64;
    const maxByShell = shellRect
      ? Math.max(
          CHAT_LIST_MIN_WIDTH,
          shellRect.width - navWidth - CHAT_MAIN_MIN_WIDTH,
        )
      : CHAT_LIST_MAX_WIDTH;
    const maxWidth = Math.min(CHAT_LIST_MAX_WIDTH, maxByShell);
    let nextWidth = clampNumber(startWidth, CHAT_LIST_MIN_WIDTH, maxWidth);

    document.body.classList.add("is-chat-column-resizing");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      nextWidth = clampNumber(
        startWidth + moveEvent.clientX - startX,
        CHAT_LIST_MIN_WIDTH,
        maxWidth,
      );
      setChatListWidth(nextWidth);
    };

    const finishResize = () => {
      document.body.classList.remove("is-chat-column-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      writeStoredLayoutNumber(CHAT_LIST_WIDTH_STORAGE_KEY, nextWidth);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  };

  const startComposerResize = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    closeContextMenus();

    const startY = event.clientY;
    const startHeight = composerHeight;
    const panel = chatMainPanelRef.current;
    const panelRect = panel?.getBoundingClientRect();
    const headerHeight =
      panel
        ?.querySelector(".chat-contact-header")
        ?.getBoundingClientRect().height ?? 58;
    const contentMinHeight =
      CHAT_COMPOSER_MIN_HEIGHT +
      (multiSelectMode ? 44 : 0) +
      (quotedMessage ? 44 : 0);
    const maxByPanel = panelRect
      ? Math.max(
          contentMinHeight,
          panelRect.height - headerHeight - CHAT_MESSAGE_MIN_HEIGHT,
        )
      : CHAT_COMPOSER_MAX_HEIGHT;
    const maxHeight = Math.min(CHAT_COMPOSER_MAX_HEIGHT, maxByPanel);
    let nextHeight = clampNumber(
      startHeight,
      contentMinHeight,
      maxHeight,
    );

    document.body.classList.add("is-chat-composer-resizing");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      nextHeight = clampNumber(
        startHeight - (moveEvent.clientY - startY),
        contentMinHeight,
        maxHeight,
      );
      setComposerHeight(nextHeight);
    };

    const finishResize = () => {
      document.body.classList.remove("is-chat-composer-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      writeStoredLayoutNumber(CHAT_COMPOSER_HEIGHT_STORAGE_KEY, nextHeight);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  };

  const renderChatComposer = () => (
    <>
      <div
        className="chat-composer-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整输入区高度"
        onPointerDown={startComposerResize}
      />

      <footer className="chat-composer">
        {multiSelectMode ? (
          <div className="message-multi-select-bar">
            <span>已选择 {selectedMessageIds.length} 条</span>
            <button
              type="button"
              disabled={selectedMessageIds.length === 0}
              onClick={() => openForwardPicker(selectedMessageIds)}
            >
              转发
            </button>
            <button
              type="button"
              disabled={selectedMessageIds.length === 0}
              onClick={removeSelectedMessagesLocally}
            >
              删除
            </button>
            <button type="button" onClick={cancelMultiSelect}>
              取消
            </button>
          </div>
        ) : null}
        <div className="composer-tools-wrap">
          <div className="composer-tools">
            <button
              ref={emojiButtonRef}
              type="button"
              title="表情"
              className={emojiPanelOpen ? "is-active" : ""}
              onClick={(event) => {
                event.stopPropagation();
                setEmojiPanelOpen((open) => {
                  if (!open) {
                    setEmojiPanelTab("emoji");
                  }
                  return !open;
                });
                setAddMenuOpen(false);
                setMoreMenuOpen(false);
              }}
            >
              <ChatIcon name="smile" />
            </button>
            <button
              type="button"
              title="文件"
              onClick={() => void selectChatUploadFiles("file")}
            >
              <ChatIcon name="folder" />
            </button>
            <button
              type="button"
              title="图片/视频"
              onClick={() => void selectChatUploadFiles("media")}
            >
              <ChatIcon name="camera" />
            </button>
            <div className="composer-tool-popover-wrap">
              <button
                type="button"
                title="截图"
                className={screenshotMenuOpen ? "is-active" : ""}
                onClick={(event) => {
                  event.stopPropagation();
                  setScreenshotMenuOpen((open) => !open);
                  setEmojiPanelOpen(false);
                  setAddMenuOpen(false);
                  setMoreMenuOpen(false);
                }}
              >
                <ChatIcon name="scissors" />
              </button>
              {screenshotMenuOpen ? (
                <div
                  className="chat-screenshot-menu"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button type="button" onClick={openScreenshotTool}>
                    截图
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={hideChatWhenScreenshot}
                      onChange={(event) =>
                        setHideChatWhenScreenshot(event.currentTarget.checked)
                      }
                    />
                    截图时隐藏当前窗口
                  </label>
                </div>
              ) : null}
            </div>
            <button type="button" title="语音">
              <ChatIcon name="mic" />
            </button>
            <button
              type="button"
              title="聊天记录"
              onClick={openChatHistoryWindow}
            >
              <ChatIcon name="history" />
            </button>
            <input
              ref={stickerInputRef}
              type="file"
              accept={STICKER_ACCEPT}
              hidden
              onChange={(event) => {
                handleStickerSelection(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
            <input
              ref={groupAvatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                void handleGroupAvatarFile(file);
              }}
            />
          </div>
          {emojiPanelOpen ? (
            <EmojiStickerPanel
              panelRef={emojiPanelRef}
              activeTab={emojiPanelTab}
              onChangeTab={setEmojiPanelTab}
              onInsertEmoji={insertEmoji}
              stickers={stickers}
              uploading={stickerUploading}
              onUpload={() => stickerInputRef.current?.click()}
              onSend={(sticker) => void sendStickerMessage(sticker)}
            />
          ) : null}
        </div>
        <div className="composer-input-row">
          {quotedMessage ? (
            <ComposerQuotePreview
              quoteMeta={quotedMessage}
              onClear={() => setQuotedMessage(null)}
            />
          ) : null}
          <textarea
            ref={draftInputRef}
            value={draft}
            placeholder="输入消息..."
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && quotedMessage) {
                event.preventDefault();
                setQuotedMessage(null);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />
          <button
            type="button"
            className="composer-send"
            onClick={() => void sendMessage()}
          >
            发送
          </button>
        </div>
      </footer>
    </>
  );

  const switchSection = (section: ChatSection) => {
    setActiveSection(section);
    closeContextMenus();
    setGroupSettingsOpen(false);
    setDirectSettingsOpen(false);
    if (section === "contacts" && accountState?.loggedIn) {
      void refreshContacts({ silent: friendsRef.current.length > 0 }).catch(
        () => undefined,
      );
    }
    if (section === "drive" && accountState?.loggedIn) {
      setDrivePanel((current) => ({
        ...current,
        mode: "personal",
        groupId: null,
        title: "我的网盘",
        open: true,
        breadcrumb: [],
        search: "",
        filter: "all",
        selectedIds: [],
        error: null,
      }));
      void refreshDrivePanel({
        mode: "personal",
        groupId: null,
        breadcrumb: [],
        search: "",
        filter: "all",
      });
    }
  };

  const selectConversation = (conversationId: string) => {
    setActiveSection("messages");
    setActiveConversationId(conversationId);
    setGroupSettingsOpen(false);
    setDirectSettingsOpen(false);
    setQuotedMessage(null);
    setMultiSelectMode(false);
    setSelectedMessageIds([]);
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, unreadCount: 0 }
          : conversation,
      ),
    );
    const latestSeq = Math.max(
      0,
      ...messages
        .filter((message) => message.conversationId === conversationId)
        .map((message) => message.conversationSeq ?? 0),
    );
    if (dataSource.live) {
      void markConversationRead(conversationId, latestSeq).catch((error) => {
        setDataSource((current) => ({ ...current, error: String(error) }));
      });
    }
    closeContextMenus();
  };

  const openConversationMenu = (
    event: MouseEvent<HTMLButtonElement>,
    conversationId: string,
  ) => {
    event.preventDefault();
    closeProfileCard();
    setConversationMenu({
      conversationId,
      x: event.clientX,
      y: event.clientY,
    });
    setMoreMenuOpen(false);
    setAddMenuOpen(false);
    setGroupSettingsOpen(false);
    setDirectSettingsOpen(false);
    setMessageMenu(null);
  };

  const openMessageMenu = (
    event: MouseEvent<HTMLElement>,
    message: ChatMessage,
  ) => {
    if (multiSelectMode) {
      return;
    }
    if (message.status === "revoked" || message.kind === "system") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closeProfileCard();
    setMessageMenu({
      messageId: message.id,
      x: event.clientX,
      y: event.clientY,
    });
    setMoreMenuOpen(false);
    setAddMenuOpen(false);
    setGroupSettingsOpen(false);
    setDirectSettingsOpen(false);
    setConversationMenu(null);
  };

  const openGroupMemberMenu = (
    event: MouseEvent<HTMLElement>,
    groupId: string,
    memberUserId: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    closeProfileCard();
    setGroupMemberMenu({
      groupId,
      memberUserId,
      x: event.clientX,
      y: event.clientY,
    });
    setMoreMenuOpen(false);
    setAddMenuOpen(false);
    setGroupSettingsOpen(false);
    setDirectSettingsOpen(false);
    setScreenshotMenuOpen(false);
    setConversationMenu(null);
    setMessageMenu(null);
  };

  const togglePinnedConversation = (conversationId: string) => {
    const nextPinned = !conversations.find(
      (conversation) => conversation.id === conversationId,
    )?.pinned;
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, pinned: nextPinned }
          : conversation,
      ),
    );
    if (dataSource.live) {
      void setConversationPinned(conversationId, nextPinned).catch((error) => {
        setDataSource((current) => ({ ...current, error: String(error) }));
      });
    }
    setConversationMenu(null);
  };

  const toggleActiveConversationPinned = () => {
    if (displayedActiveConversation) {
      togglePinnedConversation(displayedActiveConversation.id);
    }
  };

  const toggleActiveConversationMuted = () => {
    if (!displayedActiveConversation) {
      return;
    }
    const conversationId = displayedActiveConversation.id;
    const nextMuted = !displayedActiveConversation.muted;
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, muted: nextMuted }
          : conversation,
      ),
    );
    if (dataSource.live) {
      void setConversationMuted(conversationId, nextMuted).catch((error) => {
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === conversationId
              ? { ...conversation, muted: !nextMuted }
              : conversation,
          ),
        );
        setDataSource((current) => ({ ...current, error: String(error) }));
      });
    }
  };

  const requestClearConversationHistory = () => {
    if (!displayedActiveConversation) {
      return;
    }
    confirmGroupAction({
      action: "clear-history",
      groupId: activeGroupId || "",
      conversationId: displayedActiveConversation.id,
      title: "删除聊天记录",
      description:
        displayedActiveConversation.kind === "group"
          ? "将删除你在当前设备和云端可见的该会话历史记录，不会影响其他群成员，也不会退出群聊。"
          : "将删除你在当前设备和云端可见的该会话历史记录，不会删除好友关系。",
      confirmText: "删除",
      danger: true,
    });
  };

  const requestDeleteDirectFriend = () => {
    if (!displayedActiveConversation || displayedActiveConversation.kind !== "direct") {
      return;
    }
    const friendUserId = Number(displayedActiveConversation.participant.id);
    if (!Number.isInteger(friendUserId) || friendUserId <= 0) {
      return;
    }
    confirmGroupAction({
      action: "delete-friend",
      groupId: "",
      conversationId: displayedActiveConversation.id,
      memberUserId: friendUserId,
      title: "删除好友",
      description: `将从好友列表中删除“${displayedActiveConversation.title}”。删除后不会清除对方账号，但你们不再是好友。`,
      confirmText: "删除好友",
      danger: true,
    });
  };

  const startEditingGroupNickname = () => {
    const value =
      activeGroupMembers.find((member) => member.userId === currentUserId)
        ?.groupNickname ||
      activeGroupMembers.find((member) => member.userId === currentUserId)?.nickname ||
      "";
    setGroupNicknameDraft(value.slice(0, GROUP_NICKNAME_MAX_LENGTH));
    setGroupNicknameEditing(true);
    setGroupEditError(null);
  };

  const cancelEditingGroupNickname = () => {
    setGroupNicknameEditing(false);
    setGroupNicknameDraft("");
  };

  const saveGroupNickname = async (value?: string) => {
    if (!activeGroupId || groupNicknameSaving) {
      return;
    }
    const nextNickname = (value ?? groupNicknameDraft)
      .trim()
      .slice(0, GROUP_NICKNAME_MAX_LENGTH);
    try {
      setGroupNicknameSaving(true);
      setGroupEditError(null);
      const members = await updateMyChatGroupMember({
        groupId: activeGroupId,
        groupNickname: nextNickname || null,
      });
      applyGroupMembers(activeGroupId, members, displayedActiveConversation);
      setGroupNicknameEditing(false);
      setGroupNicknameDraft("");
    } catch (error) {
      setGroupEditError(friendlyError(String(error)));
    } finally {
      setGroupNicknameSaving(false);
    }
  };

  const removeConversation = (conversationId: string) => {
    setConversations((current) => {
      const next = current.filter(
        (conversation) => conversation.id !== conversationId,
      );
      if (activeConversationId === conversationId) {
        setActiveConversationId(next[0]?.id ?? "");
      }
      return next;
    });
    if (dataSource.live) {
      void archiveConversation(conversationId).catch((error) => {
        setDataSource((current) => ({ ...current, error: String(error) }));
      });
    }
    setConversationMenu(null);
  };

  const openProfileEditWindow = () => {
    void invoke("open_profile_edit_window");
  };

  const openProfileSearchWindow = () => {
    setAddMenuOpen(false);
    void invoke("open_profile_search_window");
  };

  const openClassAccountEditWindow = () => {
    setAddMenuOpen(false);
    void invoke("open_class_account_edit_window");
  };

  const openRtcTestPanel = () => {
    setMoreMenuOpen(false);
    setAddMenuOpen(false);
    setConversationMenu(null);
    setMessageMenu(null);
    setGroupMemberMenu(null);
    setGroupSettingsOpen(false);
    setDirectSettingsOpen(false);
    setRtcTestOpen(true);
  };

  const openCreateGroupDialog = (groupType: CreateGroupType = "normal") => {
    setAddMenuOpen(false);
    setMoreMenuOpen(false);
    setConversationMenu(null);
    setMessageMenu(null);
    setCreateGroupError(null);
    setCreateGroupSearch("");
    setCreateGroupType(groupType);
    setCreateGroupOpen(true);
    if (accountState?.loggedIn) {
      void refreshContacts({ silent: friendsRef.current.length > 0 }).catch(
        () => undefined,
      );
    }
  };

  const closeCreateGroupDialog = () => {
    if (creatingGroup) {
      return;
    }
    setCreateGroupOpen(false);
    setCreateGroupSearch("");
    setCreateGroupName("");
    setSelectedGroupMemberIds([]);
    setCreateGroupType("normal");
    setCreateGroupError(null);
  };

  const openInviteGroupDialog = () => {
    if (!activeGroupId) {
      return;
    }
    setInviteGroupSearch("");
    setSelectedInviteMemberIds([]);
    setInviteGroupError(null);
    setInviteGroupNotice(null);
    setInviteGroupOpen(true);
    if (accountState?.loggedIn) {
      void refreshContacts({ silent: friendsRef.current.length > 0 }).catch(
        () => undefined,
      );
    }
  };

  const closeInviteGroupDialog = () => {
    if (invitingGroup) {
      return;
    }
    setInviteGroupOpen(false);
    setInviteGroupSearch("");
    setSelectedInviteMemberIds([]);
    setInviteGroupError(null);
    setInviteGroupNotice(null);
  };

  const openRemoveGroupDialog = () => {
    if (!activeGroupId || !canManageAnyGroupMembers(activeGroup?.currentUserRole)) {
      return;
    }
    setRemoveGroupSearch("");
    setSelectedRemoveMemberIds([]);
    setRemoveGroupError(null);
    setRemoveGroupOpen(true);
  };

  const closeRemoveGroupDialog = () => {
    if (removingGroupMembers) {
      return;
    }
    setRemoveGroupOpen(false);
    setRemoveGroupSearch("");
    setSelectedRemoveMemberIds([]);
    setRemoveGroupError(null);
  };

  const toggleGroupMemberSelection = (userId: number) => {
    setCreateGroupError(null);
    setSelectedGroupMemberIds((current) => {
      if (current.includes(userId)) {
        return current.filter((item) => item !== userId);
      }
      if (current.length >= 499) {
        setCreateGroupError("群成员上限为 500 人");
        return current;
      }
      return [...current, userId];
    });
  };

  const toggleRemoveMemberSelection = (userId: number) => {
    setRemoveGroupError(null);
    setSelectedRemoveMemberIds((current) =>
      current.includes(userId)
        ? current.filter((item) => item !== userId)
        : [...current, userId],
    );
  };

  const toggleInviteMemberSelection = (userId: number) => {
    setInviteGroupError(null);
    setSelectedInviteMemberIds((current) => {
      if (current.includes(userId)) {
        return current.filter((item) => item !== userId);
      }
      const memberLimit = activeGroup?.memberLimit ?? 500;
      const activeMemberCount = activeGroupMembers.length || activeGroup?.memberCount || 0;
      if (activeMemberCount + current.length + 1 > memberLimit) {
        setInviteGroupError("群成员上限为 500 人");
        return current;
      }
      return [...current, userId];
    });
  };

  const refreshActiveGroupMembers = async (
    conversation: ChatConversation | null | undefined,
    refreshId = chatRefreshSeqRef.current,
  ) => {
    if (!conversation || conversation.kind !== "group" || !conversation.groupId) {
      return;
    }
    setGroupLoadingMap((current) => ({ ...current, [conversation.groupId as string]: true }));
    try {
      const [groupResponse, members] = await Promise.all([
        loadChatGroup(conversation.groupId),
        listChatGroupMembers(conversation.groupId),
      ]);
      if (refreshId !== chatRefreshSeqRef.current) {
        return;
      }
      const displayGroup = groupWithCachedAvatar(groupResponse.group);
      const displayConversation = conversationWithGroupAvatar(
        groupResponse.conversation,
        displayGroup,
      );
      cacheAvatarForGroup(groupResponse.group, groupResponse.conversation);
      setGroupMap((current) => ({
        ...current,
        [conversation.groupId as string]: displayGroup,
      }));
      setGroupMembersMap((current) => ({
        ...current,
        [conversation.groupId as string]: members,
      }));
      setConversations((current) =>
        upsertConversation(current, displayConversation),
      );
      setProfileMap((current) => {
        let changed = false;
        const next = { ...current };
        members.forEach((member) => {
          const profile: UserProfile = {
            userId: member.userId,
            nickname: member.nickname || member.groupNickname || `用户${member.userId}`,
            avatarUrl: member.avatarUrl ?? null,
            avatarObjectKey: member.avatarObjectKey ?? null,
            bio: "",
            online: false,
            friendStatus:
              member.userId === currentUserIdRef.current ? "self" : "unknown",
            createdAt: member.joinedAt ?? null,
            updatedAt: member.joinedAt ?? null,
          };
          const displayProfile = profileWithCachedAvatar(profile);
          cacheAvatarForProfile(profile);
          if (!sameProfile(next[displayProfile.userId], displayProfile)) {
            next[displayProfile.userId] = displayProfile;
            changed = true;
          }
        });
        return changed ? next : current;
      });
    } catch {
      // 群成员资料加载失败不阻塞聊天。
    } finally {
      if (refreshId === chatRefreshSeqRef.current) {
        setGroupLoadingMap((current) => ({
          ...current,
          [conversation.groupId as string]: false,
        }));
      }
    }
  };

  const openGroupEdit = () => {
    if (!activeGroupId) {
      return;
    }
    const group = groupMap[activeGroupId];
    setGroupEditDraft({
      name: group?.name || displayedActiveConversation?.title || "",
      avatarUrl: groupDisplayAvatarUrl(group, displayedActiveConversation),
      avatarObjectKey: group?.avatarObjectKey || null,
      description: group?.description || "",
      announcement: group?.announcement || "",
    });
    setGroupEditError(null);
    setGroupEditing(true);
    setGroupSettingsOpen(true);
    setGroupSettingsView("profile");
  };

  const openGroupAnnouncementWindow = () => {
    if (!activeGroupId || !activeGroup) {
      return;
    }
    const currentMemberRole =
      activeGroupMembers.find((member) => member.userId === currentUserId)?.role ||
      activeGroup.currentUserRole ||
      (Number.isInteger(currentUserId) && activeGroup.ownerUserId === currentUserId
        ? "owner"
        : "member");
    void invoke("open_group_announcement_window", {
      payload: {
        groupId: activeGroupId,
        groupName: activeGroup.name || displayedActiveConversation?.title || "群公告",
        currentUserRole: currentMemberRole,
      },
    });
  };

  const openGroupTitleEdit = () => {
    if (!activeGroupId || groupTitleSaving) {
      return;
    }
    const role = activeGroup?.currentUserRole;
    if (role !== "owner" && role !== "admin") {
      return;
    }
    setGroupTitleDraft(activeGroup?.name || displayedActiveConversation?.title || "");
    setGroupTitleEditing(true);
  };

  const cancelGroupTitleEdit = () => {
    if (groupTitleSaving) {
      return;
    }
    setGroupTitleEditing(false);
    setGroupTitleDraft("");
  };

  const saveGroupTitleEdit = async () => {
    if (!activeGroupId || !displayedActiveConversation) {
      return;
    }
    const name = groupTitleDraft.trim();
    const currentName = activeGroup?.name || displayedActiveConversation.title;
    if (!name) {
      setGroupTitleDraft(currentName);
      setGroupTitleEditing(false);
      return;
    }
    if (name === currentName) {
      setGroupTitleEditing(false);
      return;
    }
    try {
      setGroupTitleSaving(true);
      const { group, conversation } = await updateChatGroup({
        groupId: activeGroupId,
        name,
      });
      const displayGroup = groupWithCachedAvatar(group);
      const displayConversation = conversationWithGroupAvatar(conversation, displayGroup);
      cacheAvatarForGroup(group, conversation);
      setGroupMap((current) => ({ ...current, [group.id]: displayGroup }));
      setConversations((current) => upsertConversation(current, displayConversation));
      setGroupTitleEditing(false);
    } catch (error) {
      setDataSource((current) => ({ ...current, error: friendlyError(String(error)) }));
    } finally {
      setGroupTitleSaving(false);
    }
  };

  const cancelGroupEdit = () => {
    if (groupSaving) {
      return;
    }
    setGroupEditing(false);
    setGroupEditError(null);
  };

  const saveGroupEdit = async () => {
    if (!activeGroupId) {
      return;
    }
    const name = groupEditDraft.name.trim();
    if (!name) {
      setGroupEditError("群名称不能为空");
      return;
    }
    try {
      setGroupSaving(true);
      setGroupEditError(null);
      const { group, conversation } = await updateChatGroup({
        groupId: activeGroupId,
        name,
        avatarUrl: groupEditDraft.avatarObjectKey ? null : groupEditDraft.avatarUrl,
        avatarObjectKey: groupEditDraft.avatarObjectKey,
        description: groupEditDraft.description,
      });
      const displayGroup = groupWithCachedAvatar(group);
      const displayConversation = conversationWithGroupAvatar(conversation, displayGroup);
      cacheAvatarForGroup(group, conversation);
      setGroupMap((current) => ({ ...current, [group.id]: displayGroup }));
      setConversations((current) => upsertConversation(current, displayConversation));
      setGroupEditing(false);
      setGroupSettingsView("main");
    } catch (error) {
      setGroupEditError(friendlyError(String(error)));
    } finally {
      setGroupSaving(false);
    }
  };

  const selectGroupAvatar = () => {
    const role = activeGroup?.currentUserRole;
    if (role !== "owner" && role !== "admin") {
      return;
    }
    groupAvatarInputRef.current?.click();
  };

  const handleGroupAvatarFile = async (file: File | null | undefined) => {
    if (!file) {
      return;
    }
    try {
      setGroupSaving(true);
      setGroupEditError(null);
      const uploaded = await uploadProfileAvatarBytes({
        filename: file.name || "group-avatar.png",
        contentType: file.type || "image/png",
        bytes: await fileToBytes(file),
      });
      setGroupEditDraft((current) => ({
        ...current,
        avatarUrl: uploaded.url ?? null,
        avatarObjectKey: uploaded.objectKey ?? null,
      }));
    } catch (error) {
      setGroupEditError(friendlyError(String(error)));
    } finally {
      setGroupSaving(false);
      if (groupAvatarInputRef.current) {
        groupAvatarInputRef.current.value = "";
      }
    }
  };

  const submitCreateGroup = async () => {
    if (!dataSource.live || !accountState?.loggedIn) {
      setCreateGroupError("请先登录并连接云端");
      return;
    }
    if (selectedGroupMemberIds.length === 0) {
      setCreateGroupError("请至少选择 1 位好友");
      return;
    }
    if (createGroupType === "class") {
      const hasClassAccount = selectedGroupMemberIds.some((userId) =>
        friendsRef.current.some(
          (friend) => friend.userId === userId && friend.accountType === "class",
        ),
      );
      if (!hasClassAccount) {
        setCreateGroupError("创建班级群必须至少选择 1 个班级账号");
        return;
      }
    }
    try {
      setCreatingGroup(true);
      setCreateGroupError(null);
      const { conversation } = await createChatGroup({
        name: createGroupName.trim() || null,
        memberUserIds: selectedGroupMemberIds,
        groupType: createGroupType,
      });
      setConversations((current) => upsertConversation(current, conversation));
      setActiveSection("messages");
      setActiveConversationId(conversation.id);
      setCreateGroupOpen(false);
      setCreateGroupSearch("");
      setCreateGroupName("");
      setSelectedGroupMemberIds([]);
      setCreateGroupType("normal");
      closeContextMenus();
    } catch (error) {
      setCreateGroupError(String(error));
    } finally {
      setCreatingGroup(false);
    }
  };

  const submitInviteGroupMembers = async () => {
    if (!activeGroupId || !displayedActiveConversation) {
      setInviteGroupError("请先打开群聊");
      return;
    }
    if (!dataSource.live || !accountState?.loggedIn) {
      setInviteGroupError("请先登录并连接云端");
      return;
    }
    if (selectedInviteMemberIds.length === 0) {
      setInviteGroupError("请至少选择 1 位好友");
      return;
    }
    try {
      setInvitingGroup(true);
      setInviteGroupError(null);
      setInviteGroupNotice(null);
      const members = await inviteChatGroupMembers({
        groupId: activeGroupId,
        memberUserIds: selectedInviteMemberIds,
      });
      const directInvite =
        activeGroup?.currentUserRole === "owner" ||
        activeGroup?.currentUserRole === "admin";
      if (!directInvite) {
        setSelectedInviteMemberIds([]);
        setInviteGroupNotice("已提交群邀请申请，等待群主或管理员处理");
        void refreshContacts({ silent: true }).catch(() => undefined);
        return;
      }
      setGroupMembersMap((current) => ({
        ...current,
        [activeGroupId]: members,
      }));
      setGroupMap((current) => {
        const group = current[activeGroupId];
        if (!group) {
          return current;
        }
        return {
          ...current,
          [activeGroupId]: {
            ...group,
            memberCount: members.length,
          },
        };
      });
      setConversations((current) =>
        current.map((conversation) =>
          conversation.groupId === activeGroupId
            ? { ...conversation, groupMemberCount: members.length }
            : conversation,
        ),
      );
      setProfileMap((current) => {
        let changed = false;
        const next = { ...current };
        members.forEach((member) => {
          const profile: UserProfile = {
            userId: member.userId,
            nickname:
              member.nickname || member.groupNickname || `用户${member.userId}`,
            avatarUrl: member.avatarUrl ?? null,
            avatarObjectKey: member.avatarObjectKey ?? null,
            bio: "",
            online: false,
            friendStatus:
              member.userId === currentUserIdRef.current ? "self" : "unknown",
            createdAt: member.joinedAt ?? null,
            updatedAt: member.joinedAt ?? null,
          };
          const displayProfile = profileWithCachedAvatar(profile);
          cacheAvatarForProfile(profile);
          if (!sameProfile(next[displayProfile.userId], displayProfile)) {
            next[displayProfile.userId] = displayProfile;
            changed = true;
          }
        });
        return changed ? next : current;
      });
      setInviteGroupOpen(false);
      setInviteGroupSearch("");
      setSelectedInviteMemberIds([]);
      setInviteGroupNotice(null);
      void refreshActiveGroupMembers(displayedActiveConversation).catch(
        () => undefined,
      );
    } catch (error) {
      setInviteGroupError(friendlyError(String(error)));
    } finally {
      setInvitingGroup(false);
    }
  };

  const openFriendProfileWindow = (conversation?: ChatConversation) => {
    if (!conversation || conversation.kind !== "direct") {
      return;
    }
    const userId = Number(conversation.participant.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return;
    }
    void invoke("open_friend_profile_window", { userId });
  };

  const openGroupMemberProfile = (userId: number) => {
    if (userId === currentUserId) {
      openProfileEditWindow();
      return;
    }
    void invoke("open_friend_profile_window", { userId });
  };

  const changeContactListTab = (tab: ContactListTab) => {
    setContactListTab(tab);
    if (tab === "friends") {
      setActiveContactGroupId(null);
      setContactDetailView((view) =>
        view === "group" || view === "group-requests" ? "empty" : view,
      );
      return;
    }
    setActiveContactUserId(null);
    setContactDetailView((view) =>
      view === "friend" || view === "friend-requests" ? "empty" : view,
    );
  };

  const selectFriendContact = (profile: UserProfile) => {
    setActiveSection("contacts");
    setContactListTab("friends");
    setActiveContactUserId(profile.userId);
    setActiveContactGroupId(null);
    setContactDetailView("friend");
    closeContextMenus();
  };

  const selectGroupContact = (conversation: ChatConversation) => {
    if (conversation.kind !== "group" || !conversation.groupId) {
      return;
    }
    setActiveSection("contacts");
    setContactListTab("groups");
    setActiveContactUserId(null);
    setActiveContactGroupId(conversation.groupId);
    setContactDetailView("group");
    closeContextMenus();
    if (
      accountState?.loggedIn &&
      (!groupMapRef.current[conversation.groupId] ||
        !groupMembersMapRef.current[conversation.groupId])
    ) {
      void refreshActiveGroupMembers(conversation).catch(() => undefined);
    }
  };

  const openFriendRequests = () => {
    setActiveSection("contacts");
    setContactListTab("friends");
    setActiveContactUserId(null);
    setActiveContactGroupId(null);
    setContactDetailView("friend-requests");
    if (accountState?.loggedIn) {
      void refreshContacts({ silent: true }).catch(() => undefined);
    }
    closeContextMenus();
  };

  const openGroupRequests = () => {
    setActiveSection("contacts");
    setContactListTab("groups");
    setActiveContactUserId(null);
    setActiveContactGroupId(null);
    setContactDetailView("group-requests");
    if (accountState?.loggedIn) {
      void refreshContacts({ silent: true }).catch(() => undefined);
    }
    closeContextMenus();
  };

  const updateFriendRequestStatus = async (
    request: FriendRequest,
    action: "accept" | "reject",
  ) => {
    try {
      setContactsError(null);
      const saved =
        action === "accept"
          ? await acceptFriendRequest(request.id)
          : await rejectFriendRequest(request.id);
      setFriendRequests((current) => upsertFriendRequest(current, saved));
      if (action === "accept") {
        const friendProfile =
          saved.fromUserId === currentUserIdRef.current
            ? saved.toProfile
            : saved.fromProfile;
        if (friendProfile) {
          cacheAvatarForProfile(friendProfile);
          const displayProfile = profileWithCachedAvatar({
            ...friendProfile,
            friendStatus: "friend",
          });
          setFriends((current) => upsertProfile(current, displayProfile));
          setProfileMap((current) =>
            sameProfile(current[displayProfile.userId], displayProfile)
              ? current
              : {
                  ...current,
                  [displayProfile.userId]: displayProfile,
                },
          );
        }
        void refreshContacts({ silent: true }).catch(() => undefined);
      }
    } catch (error) {
      setContactsError(String(error));
    }
  };

  const applyNewFriendProfile = (profile: UserProfile) => {
    cacheAvatarForProfile(profile);
    const friend = profileWithCachedAvatar({
      ...profile,
      friendStatus: "friend",
    });
    setFriends((current) => upsertProfile(current, friend));
    setProfileMap((current) =>
      sameProfile(current[friend.userId], friend)
        ? current
        : { ...current, [friend.userId]: friend },
    );
  };

  const applyFriendRealtimeEvent = (
    eventName: "friend.request.created" | "friend.request.accepted" | "friend.request.rejected",
    request: FriendRequest,
  ) => {
    cacheAvatarForProfile(request.fromProfile);
    cacheAvatarForProfile(request.toProfile);
    const displayRequest = {
      ...request,
      fromProfile: request.fromProfile
        ? profileWithCachedAvatar(request.fromProfile)
        : request.fromProfile,
      toProfile: request.toProfile
        ? profileWithCachedAvatar(request.toProfile)
        : request.toProfile,
    };
    setFriendRequests((current) => upsertFriendRequest(current, displayRequest));
    [displayRequest.fromProfile, displayRequest.toProfile].forEach((profile) => {
      if (profile) {
        applyProfileToChatState(profile);
      }
    });
    if (eventName === "friend.request.accepted") {
      const currentUserIdValue = currentUserIdRef.current;
      const friendProfile =
        displayRequest.fromUserId === currentUserIdValue
          ? displayRequest.toProfile
          : displayRequest.toUserId === currentUserIdValue
            ? displayRequest.fromProfile
            : null;
      if (friendProfile) {
        const friend = { ...friendProfile, friendStatus: "friend" as const };
        setFriends((current) => upsertProfile(current, friend));
        setProfileMap((current) =>
          sameProfile(current[friend.userId], friend)
            ? current
            : { ...current, [friend.userId]: friend },
        );
      }
    }
  };

  const applyGroupMembers = (
    groupId: string,
    members: ChatGroupMember[],
    conversation: ChatConversation | null | undefined = displayedActiveConversation,
  ) => {
    setGroupMembersMap((current) => ({ ...current, [groupId]: members }));
    setGroupMap((current) => {
      const group = current[groupId];
      if (!group) {
        return current;
      }
      return {
        ...current,
        [groupId]: {
          ...group,
          memberCount: members.length,
          currentUserRole:
            members.find((member) => member.userId === currentUserIdRef.current)
              ?.role ?? group.currentUserRole,
        },
      };
    });
    setConversations((current) =>
      current.map((item) =>
        item.groupId === groupId ? { ...item, groupMemberCount: members.length } : item,
      ),
    );
    if (conversation) {
      void refreshActiveGroupMembers(conversation).catch(() => undefined);
    }
  };

  const confirmGroupAction = (state: GroupConfirmState) => {
    setGroupMemberMenu(null);
    setGroupConfirm(state);
  };

  const runGroupConfirmAction = async () => {
    if (!groupConfirm || groupActionBusy) {
      return;
    }
    const state = groupConfirm;
    try {
      setGroupActionBusy(true);
      setDataSource((current) => ({ ...current, error: null }));
      if (state.action === "set-admin" && state.memberUserId) {
        const members = await setChatGroupAdmin({
          groupId: state.groupId,
          userId: state.memberUserId,
        });
        applyGroupMembers(state.groupId, members);
      }
      if (state.action === "unset-admin" && state.memberUserId) {
        const members = await unsetChatGroupAdmin({
          groupId: state.groupId,
          userId: state.memberUserId,
        });
        applyGroupMembers(state.groupId, members);
      }
      if (state.action === "transfer-owner" && state.memberUserId) {
        const members = await transferChatGroupOwner({
          groupId: state.groupId,
          userId: state.memberUserId,
        });
        applyGroupMembers(state.groupId, members);
      }
      if (state.action === "remove-member" && state.memberUserId) {
        const members = await removeChatGroupMember({
          groupId: state.groupId,
          userId: state.memberUserId,
        });
        applyGroupMembers(state.groupId, members);
      }
      if (state.action === "remove-members" && state.memberUserIds?.length) {
        setRemovingGroupMembers(true);
        let latestMembers: ChatGroupMember[] = [];
        for (const userId of state.memberUserIds) {
          latestMembers = await removeChatGroupMember({
            groupId: state.groupId,
            userId,
          });
        }
        applyGroupMembers(state.groupId, latestMembers);
        setRemoveGroupOpen(false);
        setRemoveGroupSearch("");
        setSelectedRemoveMemberIds([]);
      }
      if (state.action === "leave-group") {
        await leaveChatGroup(state.groupId);
        setConversations((current) => {
          const next = current.filter((item) => item.groupId !== state.groupId);
          if (activeGroupId === state.groupId) {
            setActiveConversationId(next[0]?.id ?? "");
          }
          return next;
        });
        setGroupMap((current) => {
          const next = { ...current };
          delete next[state.groupId];
          return next;
        });
        setGroupMembersMap((current) => {
          const next = { ...current };
          delete next[state.groupId];
          return next;
        });
        setGroupSettingsOpen(false);
      }
      if (state.action === "dissolve-group") {
        await dissolveChatGroup(state.groupId);
        setConversations((current) => {
          const next = current.filter((item) => item.groupId !== state.groupId);
          if (activeGroupId === state.groupId) {
            setActiveConversationId(next[0]?.id ?? "");
          }
          return next;
        });
        setGroupMap((current) => {
          const next = { ...current };
          delete next[state.groupId];
          return next;
        });
        setGroupMembersMap((current) => {
          const next = { ...current };
          delete next[state.groupId];
          return next;
        });
        setGroupSettingsOpen(false);
      }
      if (state.action === "clear-history" && state.conversationId) {
        await clearConversationHistory(state.conversationId);
        setMessages((current) =>
          current.filter((message) => message.conversationId !== state.conversationId),
        );
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === state.conversationId
              ? { ...conversation, subtitle: "暂无消息", timeLabel: "", unreadCount: 0 }
              : conversation,
          ),
        );
        setHistoryExhaustedMap((current) => {
          const next = { ...current };
          delete next[state.conversationId as string];
          return next;
        });
        clearCachedConversationMessages(activeAccountKeyRef.current, state.conversationId);
      }
      if (state.action === "delete-friend" && state.memberUserId) {
        const friendUserId = state.memberUserId;
        await deleteFriend(friendUserId);
        const removedConversationId = state.conversationId ?? null;
        setFriends((current) =>
          current.filter((friend) => friend.userId !== friendUserId),
        );
        setProfileMap((current) => {
          const profile = current[friendUserId];
          if (!profile) {
            return current;
          }
          return {
            ...current,
            [friendUserId]: {
              ...profile,
              friendStatus: profile.friendStatus === "self" ? "self" : "none",
            },
          };
        });
        if (removedConversationId) {
          setMessages((current) =>
            current.filter((message) => message.conversationId !== removedConversationId),
          );
          setHistoryExhaustedMap((current) => {
            const next = { ...current };
            delete next[removedConversationId];
            return next;
          });
          clearCachedConversationMessages(activeAccountKeyRef.current, removedConversationId);
          setConversations((current) => {
            const next = current.filter(
              (conversation) => conversation.id !== removedConversationId,
            );
            if (activeConversationIdRef.current === removedConversationId) {
              setActiveConversationId(next[0]?.id ?? "");
            }
            return next;
          });
          if (dataSource.live) {
            void archiveConversation(removedConversationId).catch((error) => {
              setDataSource((current) => ({
                ...current,
                error: friendlyError(String(error)),
              }));
            });
          }
        }
        setDirectSettingsOpen(false);
        closeContextMenus();
      }
      setGroupConfirm(null);
    } catch (error) {
      setDataSource((current) => ({ ...current, error: friendlyError(String(error)) }));
    } finally {
      if (state.action === "remove-members") {
        setRemovingGroupMembers(false);
      }
      setGroupActionBusy(false);
    }
  };

  const memberDisplayName = (member: ChatGroupMember | null | undefined): string =>
    member?.groupNickname || member?.nickname || `用户${member?.userId ?? ""}`;

  const requestGroupMemberAction = (
    action: GroupConfirmAction,
    member?: ChatGroupMember | null,
  ) => {
    if (!activeGroupId) {
      return;
    }
    const name = memberDisplayName(member);
    if (action === "set-admin" && member) {
      confirmGroupAction({
        action,
        groupId: activeGroupId,
        memberUserId: member.userId,
        title: "设为管理员",
        description: `确定将 ${name} 设为管理员？`,
        confirmText: "设为管理员",
      });
    }
    if (action === "unset-admin" && member) {
      confirmGroupAction({
        action,
        groupId: activeGroupId,
        memberUserId: member.userId,
        title: "取消管理员",
        description: `确定取消 ${name} 的管理员权限？`,
        confirmText: "取消管理员",
      });
    }
    if (action === "transfer-owner" && member) {
      confirmGroupAction({
        action,
        groupId: activeGroupId,
        memberUserId: member.userId,
        title: "转让群主",
        description: `确定将群主转让给 ${name}？转让后你将变为管理员。`,
        confirmText: "转让",
        danger: true,
      });
    }
    if (action === "remove-member" && member) {
      confirmGroupAction({
        action,
        groupId: activeGroupId,
        memberUserId: member.userId,
        title: "移出群聊",
        description: `确定将 ${name} 移出群聊？`,
        confirmText: "移出",
        danger: true,
      });
    }
    if (action === "remove-members") {
      const memberUserIds = selectedRemoveMemberIds;
      if (memberUserIds.length === 0) {
        setRemoveGroupError("请选择要移出的成员");
        return;
      }
      confirmGroupAction({
        action,
        groupId: activeGroupId,
        memberUserIds,
        title: "移出群聊",
        description: `确定将选中的 ${memberUserIds.length} 位成员移出群聊？`,
        confirmText: "移出",
        danger: true,
      });
    }
    if (action === "leave-group") {
      confirmGroupAction({
        action,
        groupId: activeGroupId,
        title: "退出群聊",
        description: "退出后将不再收到该群消息，聊天列表也会移除该群。",
        confirmText: "退出",
        danger: true,
      });
    }
    if (action === "dissolve-group") {
      confirmGroupAction({
        action,
        groupId: activeGroupId,
        title: "解散群聊",
        description: "解散后所有成员都将失去该群会话。这是不可逆操作。",
        confirmText: "解散",
        danger: true,
      });
    }
  };

  const applyGroupRealtimeEvent = (
    eventName: "group.join_request.created" | "group.join_request.handled",
    request: ChatGroupJoinRequest,
  ) => {
    const displayRequest = normalizeGroupRequestProfiles(request);
    setGroupRequests((current) => upsertGroupRequest(current, displayRequest));
    [
      displayRequest.applicantProfile,
      displayRequest.inviterProfile,
      displayRequest.handledByProfile,
    ].forEach((profile) => {
      if (profile) {
        applyProfileToChatState(profile);
      }
    });
    if (
      displayRequest.applicantUserId === currentUserIdRef.current ||
      displayRequest.canHandle
    ) {
      if (eventName === "group.join_request.created") {
        syncPinnedGroupProfileCardState(displayRequest.groupId, {
          membership: groupMembershipStateFor(displayRequest.groupId),
          loading: false,
          membersLoading: false,
          members: [],
        });
      } else if (displayRequest.status === "accepted") {
        syncPinnedGroupProfileCardState(displayRequest.groupId, {
          membership: "joined",
          membersLoading: true,
        });
      } else if (displayRequest.status === "rejected") {
        syncPinnedGroupProfileCardState(displayRequest.groupId, {
          membership: "not_joined",
          loading: false,
          membersLoading: false,
          members: [],
        });
      }
    }
    if (
      eventName === "group.join_request.handled" &&
      displayRequest.status === "accepted"
    ) {
      void refreshConversations({ clearMessages: false }).catch(() => undefined);
      hydrateGroupProfileCard(displayRequest.groupId);
      const activeGroupConversation = conversationsRef.current.find(
        (conversation) =>
          conversation.id === activeConversationIdRef.current &&
          conversation.kind === "group" &&
          conversation.groupId === displayRequest.groupId,
      );
      if (activeGroupConversation) {
        void refreshActiveGroupMembers(activeGroupConversation).catch(
          () => undefined,
        );
      }
    }
  };

  const updateGroupRequestStatus = async (
    request: ChatGroupJoinRequest,
    action: "accept" | "reject",
  ) => {
    try {
      setContactsError(null);
      const saved =
        action === "accept"
          ? await acceptChatGroupJoinRequest(request.id)
          : await rejectChatGroupJoinRequest(request.id);
      const displayRequest = normalizeGroupRequestProfiles(saved);
      setGroupRequests((current) => upsertGroupRequest(current, displayRequest));
      [
        displayRequest.applicantProfile,
        displayRequest.inviterProfile,
        displayRequest.handledByProfile,
      ].forEach((profile) => {
        if (profile) {
          applyProfileToChatState(profile);
        }
      });
      if (action === "accept") {
        void refreshConversations({ clearMessages: false }).catch(() => undefined);
        const activeGroupConversation = conversationsRef.current.find(
          (conversation) =>
            conversation.id === activeConversationIdRef.current &&
            conversation.kind === "group" &&
            conversation.groupId === displayRequest.groupId,
        );
        if (activeGroupConversation) {
          void refreshActiveGroupMembers(activeGroupConversation).catch(
            () => undefined,
          );
        }
      }
      void refreshContacts({ silent: true }).catch(() => undefined);
    } catch (error) {
      setContactsError(friendlyError(String(error)));
    }
  };

  const openDirectConversation = async (peerUserId: number) => {
    if (!Number.isInteger(peerUserId) || peerUserId <= 0) {
      return;
    }
    try {
      setDataSource((current) => ({ ...current, error: null }));
      const conversation = await createDirectConversation(peerUserId);
      const profile =
        profileMapRef.current[peerUserId] ??
        friendsRef.current.find((friend) => friend.userId === peerUserId) ??
        null;
      const displayedConversation = profile
        ? mergeProfileIntoConversation(conversation, profile)
        : conversation;
      setConversations((current) =>
        upsertConversation(current, displayedConversation),
      );
      setActiveConversationId(displayedConversation.id);
      setActiveSection("messages");
      setGroupSettingsOpen(false);
      setDirectSettingsOpen(false);
      closeContextMenus();
      if (dataSource.live) {
        void refreshConversations({ clearMessages: false }).catch(
          () => undefined,
        );
      }
    } catch (error) {
      setDataSource((current) => ({ ...current, error: String(error) }));
    }
  };

  const applyRevokedMessage = (message: ChatMessage) => {
    const normalizedMessage = normalizeMessageDirection(message);
    setMessages((current) => {
      if (!current.some((item) => item.id === normalizedMessage.id)) {
        return current;
      }
      return current.map((item) =>
        item.id === normalizedMessage.id
          ? { ...item, ...normalizedMessage, status: "revoked" }
          : item,
      );
    });
    const latestKnownSeq = Math.max(
      0,
      ...messagesRef.current
        .filter((item) => item.conversationId === normalizedMessage.conversationId)
        .map((item) => item.conversationSeq ?? 0),
    );
    if ((normalizedMessage.conversationSeq ?? 0) >= latestKnownSeq) {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === normalizedMessage.conversationId
            ? {
                ...conversation,
                subtitle: revokedMessageText(normalizedMessage),
                timeLabel: normalizedMessage.timeLabel || conversation.timeLabel,
              }
            : conversation,
        ),
      );
    }
  };

  const normalizeMessageDirection = (message: ChatMessage): ChatMessage => {
    const senderUserId = currentUserIdRef.current;
    if (senderUserId !== null && message.senderId === senderUserId) {
      return { ...message, direction: "outgoing" };
    }
    if (message.kind === "system") {
      return message;
    }
    return { ...message, direction: "incoming" };
  };

  const createLocalMessage = (
    kind: ChatMessageKind,
    content: string,
    contentJson?: Record<string, unknown> | null,
    fileObjectId?: string | null,
    quoteMeta?: QuoteMeta | null,
  ): ChatMessage => {
    const now = new Date();
    const timeLabel = `${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
    return {
      id: `msg-local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      conversationId: activeConversation?.id ?? "",
      kind,
      direction: "outgoing",
      content,
      contentJson: contentJson ?? null,
      quoteMeta: quoteMeta ?? null,
      fileObjectId: fileObjectId ?? null,
      timeLabel,
      createdAt: now.toISOString(),
      senderId: currentUserId,
      status: "sending",
    };
  };

  const sendMessage = async () => {
    const content = draft.trim();
    if (!content || !activeConversation) {
      return;
    }

    const quote = quotedMessage;
    const contentJson = withQuoteMeta(null, quote);
    const message = createLocalMessage("text", content, contentJson, null, quote);
    scheduleScrollToLatestSelfMessage(activeConversation.id);
    setMessages((current) => [...current, message]);
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? { ...conversation, subtitle: content, timeLabel: message.timeLabel ?? "" }
          : conversation,
      ),
    );
    setDraft("");
    setQuotedMessage(null);

    if (!dataSource.live) {
      return;
    }

    const refreshId = chatRefreshSeqRef.current;
    try {
      const saved = quote
        ? await postTypedChatMessage({
            conversationId: activeConversation.id,
            messageType: "text",
            content,
            contentJson,
            quoteMeta: quote,
          })
        : await postChatMessage(activeConversation.id, content);
      if (refreshId !== chatRefreshSeqRef.current) {
        return;
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? { ...saved, direction: "outgoing", senderId: currentUserId }
            : item,
        ),
      );
    } catch (error) {
      if (refreshId !== chatRefreshSeqRef.current) {
        return;
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, status: "failed" } : item,
        ),
      );
      setQuotedMessage((current) => current ?? quote);
      setDraft((current) => current || content);
      setDataSource((current) => ({ ...current, error: String(error) }));
    }
  };

  const insertEmoji = (emoji: string) => {
    const input = draftInputRef.current;
    if (!input) {
      setDraft((current) => `${current}${emoji}`);
      return;
    }
    const start = input.selectionStart ?? draft.length;
    const end = input.selectionEnd ?? start;
    const nextDraft = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
    const nextCursor = start + emoji.length;
    setDraft(nextDraft);
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const sendAttachmentMessage = async (
    file: File,
    kind: "image" | "video" | "file",
  ) => {
    if (!activeConversation) {
      return;
    }
    const quote = quotedMessage;
    const localUrl = kind === "image" ? URL.createObjectURL(file) : null;
    const localContentJson = withQuoteMeta({
      fileName: file.name,
      sizeBytes: file.size,
      contentType: file.type || "application/octet-stream",
      url: localUrl,
    }, quote);
    const localMessage = createLocalMessage(
      kind,
      kind === "image"
        ? "[图片]"
        : kind === "video"
          ? `[视频] ${file.name}`
          : `[文件] ${file.name}`,
      localContentJson,
      null,
      quote,
    );
    scheduleScrollToLatestSelfMessage(activeConversation.id);
    setMessages((current) => [...current, localMessage]);
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? {
              ...conversation,
              subtitle: messagePreview(localMessage),
              timeLabel: localMessage.timeLabel ?? conversation.timeLabel,
            }
          : conversation,
      ),
    );
    setQuotedMessage(null);

    if (!dataSource.live) {
      return;
    }

    const refreshId = chatRefreshSeqRef.current;
    try {
      const uploaded = await uploadChatFileBytes({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        bytes: await fileToBytes(file),
        fileType: kind,
      });
      const contentJson = withQuoteMeta(fileContentJson(uploaded), quote);
      const saved = await postTypedChatMessage({
        conversationId: activeConversation.id,
        messageType: kind,
        content:
          kind === "image"
            ? "[图片]"
            : kind === "video"
              ? `[视频] ${uploaded.originalName || file.name}`
              : `[文件] ${uploaded.originalName || file.name}`,
        contentJson,
        quoteMeta: quote,
        fileObjectId: uploaded.id,
      });
      if (refreshId !== chatRefreshSeqRef.current) {
        return;
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === localMessage.id
            ? { ...saved, direction: "outgoing", senderId: currentUserId }
            : item,
        ),
      );
    } catch (error) {
      if (refreshId !== chatRefreshSeqRef.current) {
        return;
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === localMessage.id ? { ...item, status: "failed" } : item,
        ),
      );
      setQuotedMessage((current) => current ?? quote);
      setDataSource((current) => ({ ...current, error: String(error) }));
    }
  };

  const sendLocalUploadFiles = async (files: LocalUploadFile[]) => {
    if (!activeConversation || files.length === 0) {
      return;
    }
    const largeFiles = files.filter((file) => file.sizeBytes >= LARGE_FILE_CONFIRM_BYTES);
    let saveToPersonalDrive = false;
    let saveToGroupDrive = false;
    if (largeFiles.length > 0) {
      const totalSize = largeFiles.reduce((sum, file) => sum + file.sizeBytes, 0);
      const target = activeConversation.title || "当前会话";
      const confirmed = window.confirm(
        largeFiles.length === 1
          ? `发送大文件\n\n${largeFiles[0].name}\n${formatBytes(largeFiles[0].sizeBytes)}\n\n发送到：${target}\n\n点击“确定”发送，点击“取消”放弃。`
          : `发送 ${largeFiles.length} 个大文件\n\n总大小：${formatBytes(totalSize)}\n发送到：${target}\n\n点击“确定”发送，点击“取消”放弃。`,
      );
      if (!confirmed) {
        return;
      }
      saveToPersonalDrive = window.confirm("是否同时存入我的网盘？\n\n默认不会自动保存，点击“确定”才会保存。");
      if (activeConversation.kind === "group" && canManageGroupDrive(activeGroup)) {
        saveToGroupDrive = window.confirm("是否同时存入群网盘？\n\n仅群主/管理员可保存到群网盘。");
      }
    }
    for (const file of files) {
      void sendLocalUploadFile(file, { saveToPersonalDrive, saveToGroupDrive });
    }
  };

  sendLocalUploadFilesRef.current = sendLocalUploadFiles;

  const sendLocalUploadFile = async (
    file: LocalUploadFile,
    options: {
      saveToPersonalDrive?: boolean;
      saveToGroupDrive?: boolean;
      retryTaskId?: string;
      localMessageId?: string | null;
    } = {},
  ) => {
    const conversation = activeConversation;
    if (!conversation) {
      return;
    }
    const kind = normalizeLocalUploadKind(file);
    const quote = quotedMessage;
    const taskId =
      options.retryTaskId ?? `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const videoPosterPromise =
      kind === "video"
        ? createVideoPosterSnapshot(file.path).catch(() => null)
        : Promise.resolve<VideoPosterSnapshot | null>(null);
    const localContentJson = withQuoteMeta({
      fileName: file.name,
      sizeBytes: file.sizeBytes,
      contentType: file.contentType || "application/octet-stream",
      fileType: kind,
      localPath: file.path,
      uploadTaskId: taskId,
      uploadStatus: "waiting",
      progress: 0,
      url: null,
      thumbnailUrl: null,
      previewUrl: null,
      posterUrl: null,
      thumbnailLocalPath: null,
      posterLocalPath: null,
      thumbnailWidth: null,
      thumbnailHeight: null,
      posterStatus: kind === "video" ? "pending" : null,
    }, quote);
    const localMessage =
      options.localMessageId
        ? messagesRef.current.find((item) => item.id === options.localMessageId) ?? null
        : createLocalMessage(
            kind,
            uploadMessageContent(kind, file.name),
            localContentJson,
            null,
            quote,
          );
    if (!localMessage) {
      return;
    }
    if (!options.retryTaskId) {
      scheduleScrollToLatestSelfMessage(conversation.id);
      setMessages((current) => [...current, localMessage]);
      setConversations((current) =>
        current.map((item) =>
          item.id === conversation.id
            ? {
                ...item,
                subtitle: messagePreview(localMessage),
                timeLabel: localMessage.timeLabel ?? item.timeLabel,
              }
            : item,
        ),
      );
      setQuotedMessage(null);
    }
    upsertTransferTask({
      id: taskId,
      direction: "upload",
      conversationId: conversation.id,
      localMessageId: localMessage.id,
      fileName: file.name,
      filePath: file.path,
      fileType: kind,
      contentType: file.contentType || "application/octet-stream",
      fileSize: file.sizeBytes,
      uploadedBytes: 0,
      downloadedBytes: 0,
      status: "waiting",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      saveToPersonalDrive: options.saveToPersonalDrive,
      saveToGroupDrive: options.saveToGroupDrive,
    });
    setTransferDrawerOpen(true);
    if (kind === "video") {
      videoPosterPromise.then((snapshot) => {
        if (!snapshot) {
          return;
        }
        setMessages((current) =>
          current.map((item) =>
            item.id === localMessage.id
              ? {
                  ...item,
                  contentJson: {
                    ...(item.contentJson ?? {}),
                    thumbnailUrl: snapshot.localUrl || snapshot.dataUrl,
                    previewUrl: snapshot.localUrl || snapshot.dataUrl,
                    posterUrl: snapshot.localUrl || snapshot.dataUrl,
                    thumbnailLocalPath: snapshot.localPath ?? null,
                    posterLocalPath: snapshot.localPath ?? null,
                    thumbnailWidth: snapshot.width,
                    thumbnailHeight: snapshot.height,
                    posterTimeSeconds: snapshot.timeSeconds,
                    posterStatus: snapshot.localPath ? "local_cached" : "local_memory",
                  },
                }
              : item,
          ),
        );
      });
    }

    if (!dataSource.live) {
      return;
    }

    const refreshId = chatRefreshSeqRef.current;
    try {
      const uploaded = await uploadChatFilePathChunked({
        filePath: file.path,
        fileType: kind,
        contentType: file.contentType || "application/octet-stream",
        chunkSize: DEFAULT_CHAT_CHUNK_SIZE,
        taskId,
      });
      const videoPoster = await videoPosterPromise;
      let uploadedPoster: UploadedChatFile | null = null;
      if (kind === "video" && videoPoster) {
        uploadedPoster = await uploadChatFileBytes({
          filename: `${stripFileExtension(uploaded.originalName || file.name)}.poster.jpg`,
          contentType: "image/jpeg",
          bytes: videoPoster.bytes,
          fileType: "image",
        }).catch(() => null);
      }
      const contentJson = withQuoteMeta(
        videoPoster
          ? {
              ...fileContentJson(uploaded),
              thumbnailObjectId: uploadedPoster?.id ?? null,
              thumbnailFileObjectId: uploadedPoster?.id ?? null,
              thumbObjectId: uploadedPoster?.id ?? null,
              posterObjectId: uploadedPoster?.id ?? null,
              thumbnailWidth: videoPoster.width,
              thumbnailHeight: videoPoster.height,
              posterTimeSeconds: videoPoster.timeSeconds,
              posterStatus: uploadedPoster ? "available" : "local_only",
            }
          : fileContentJson(uploaded),
        quote,
      );
      const saved = await postTypedChatMessage({
        conversationId: conversation.id,
        messageType: kind,
        content: uploadMessageContent(kind, uploaded.originalName || file.name),
        contentJson,
        quoteMeta: quote,
        fileObjectId: uploaded.id,
      });
      const displaySaved =
        kind === "video" && videoPoster
          ? {
              ...saved,
              contentJson: {
                ...(saved.contentJson ?? {}),
                // Keep the already-rendered local poster during the local->server
                // message swap. The remote poster object is still stored on the
                // server for receivers/history, but this avoids a placeholder flash.
                localPath: file.path,
                thumbnailUrl: videoPoster.localUrl || videoPoster.dataUrl,
                previewUrl: videoPoster.localUrl || videoPoster.dataUrl,
                posterUrl: videoPoster.localUrl || videoPoster.dataUrl,
                thumbnailLocalPath: videoPoster.localPath ?? null,
                posterLocalPath: videoPoster.localPath ?? null,
              },
            }
          : {
              ...saved,
              contentJson: {
                ...(saved.contentJson ?? {}),
                localPath: file.path,
              },
            };
      rememberLocalMediaPath(sentLocalMediaPathRef.current, displaySaved, file.path);
      if (refreshId !== chatRefreshSeqRef.current) {
        return;
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === localMessage.id
            ? { ...displaySaved, direction: "outgoing", senderId: currentUserId }
            : item,
        ),
      );
      setConversations((current) =>
        current.map((item) =>
          item.id === conversation.id
            ? {
                ...item,
                subtitle: messagePreview(displaySaved),
                timeLabel: displaySaved.timeLabel ?? item.timeLabel,
              }
            : item,
        ),
      );
      markTransferTaskComplete(taskId, uploaded);
      if (options.saveToPersonalDrive) {
        void saveUploadedFileToDrive("personal", uploaded, null);
      }
      if (options.saveToGroupDrive && conversation.kind === "group" && conversation.groupId) {
        void saveUploadedFileToDrive("group", uploaded, conversation.groupId);
      }
    } catch (error) {
      if (refreshId !== chatRefreshSeqRef.current) {
        return;
      }
      const status = String(error).includes("upload canceled") ? "canceled" : "failed";
      setMessages((current) =>
        current.map((item) =>
          item.id === localMessage.id
            ? {
                ...item,
                status,
                contentJson: {
                  ...(item.contentJson ?? {}),
                  uploadStatus: status,
                  errorMessage: friendlyError(String(error)),
                },
              }
            : item,
        ),
      );
      updateTransferTask(taskId, {
        status,
        errorMessage: friendlyError(String(error)),
        updatedAt: Date.now(),
      });
      if (status === "failed") {
        setDataSource((current) => ({ ...current, error: friendlyError(String(error)) }));
      }
    }
  };

  const upsertTransferTask = (task: TransferTask) => {
    setTransferTasks((current) => {
      const index = current.findIndex((item) => item.id === task.id);
      if (index < 0) {
        return [task, ...current];
      }
      return current.map((item) =>
        item.id === task.id ? { ...item, ...task, updatedAt: Date.now() } : item,
      );
    });
  };

  const updateTransferTask = (
    taskId: string,
    patch: Partial<TransferTask>,
  ) => {
    setTransferTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, ...patch, updatedAt: Date.now() } : task,
      ),
    );
  };

  const markTransferTaskComplete = (taskId: string, file: UploadedChatFile) => {
    updateTransferTask(taskId, {
      status: "completed",
      uploadedBytes: file.sizeBytes,
      fileSize: file.sizeBytes,
      fileObjectId: file.id,
      speedBytes: 0,
      remainingSeconds: 0,
      errorMessage: null,
    });
  };

  const applyTransferEvent = (event: ChatTransferEvent) => {
    const task = transferTasksRef.current.find((item) => item.id === event.taskId);
    const nextStatus = event.status || task?.status || "uploading";
    updateTransferTask(event.taskId, {
      status: nextStatus,
      fileName: event.fileName || task?.fileName || "文件",
      fileSize: event.fileSize ?? task?.fileSize ?? 0,
      uploadedBytes: event.uploadedBytes ?? task?.uploadedBytes ?? 0,
      downloadedBytes: event.downloadedBytes ?? task?.downloadedBytes ?? 0,
      speedBytes: event.speedBytes ?? task?.speedBytes,
      remainingSeconds: event.remainingSeconds ?? task?.remainingSeconds ?? null,
      errorMessage: event.errorMessage ?? null,
      fileObjectId: event.file?.id ?? task?.fileObjectId ?? null,
    });
    if (!task?.localMessageId) {
      return;
    }
    const progress = event.fileSize
      ? Math.min(100, Math.round(((event.uploadedBytes ?? 0) / event.fileSize) * 100))
      : 0;
    setMessages((current) =>
      current.map((message) =>
        message.id === task.localMessageId
          ? {
              ...message,
              status:
                nextStatus === "failed" || nextStatus === "canceled"
                  ? nextStatus
                  : "sending",
              contentJson: {
                ...(message.contentJson ?? {}),
                uploadStatus: nextStatus,
                progress,
                speedBytes: event.speedBytes ?? null,
                remainingSeconds: event.remainingSeconds ?? null,
                errorMessage: event.errorMessage ?? null,
              },
            }
          : message,
      ),
    );
  };

  const saveUploadedFileToDrive = async (
    driveType: "personal" | "group",
    file: UploadedChatFile,
    groupId: string | null,
  ) => {
    try {
      const node = await saveFileToDrive({
        driveType,
        groupId,
        parentId: null,
        fileObjectId: file.id,
        name: file.originalName || "文件",
      });
      setDriveSaveNotice({
        id: node.id,
        label: driveType === "group" ? "已存入群网盘" : "已存入我的网盘",
      });
      window.setTimeout(() => setDriveSaveNotice(null), 2200);
      if (
        drivePanelRef.current.open &&
        drivePanelRef.current.mode === driveType &&
        (driveType === "personal" || drivePanelRef.current.groupId === groupId)
      ) {
        void refreshDrivePanel();
      }
    } catch (error) {
      setDataSource((current) => ({ ...current, error: friendlyError(String(error)) }));
    }
  };

  const selectChatUploadFiles = async (kind: "file" | "media") => {
    if (!activeConversation) {
      setDataSource((current) => ({ ...current, error: "请先选择一个会话" }));
      return;
    }
    try {
      const files = await pickChatUploadFiles({ kind, multiple: true });
      await sendLocalUploadFiles(files);
    } catch (error) {
      setDataSource((current) => ({ ...current, error: friendlyError(String(error)) }));
    }
  };

  const handleChatDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!activeConversation) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setChatDragActive(true);
  };

  const handleChatDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setChatDragActive(false);
    }
  };

  const handleChatDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setChatDragActive(false);
  };

  const openGroupDrivePanel = (conversation: ChatConversation) => {
    if (!conversation.groupId) {
      return;
    }
    const groupTitle = groupMapRef.current[conversation.groupId]?.name || conversation.title;
    void invoke("open_drive_window", {
      payload: {
        mode: "group",
        groupId: conversation.groupId,
        title: `${groupTitle} · 群网盘`,
        canManage: canManageGroupDrive(groupMapRef.current[conversation.groupId] ?? null),
      },
    }).catch((error) => {
      setDataSource((current) => ({ ...current, error: friendlyError(String(error)) }));
    });
  };

  const openPersonalDriveWindow = () => {
    void invoke("open_drive_window", {
      payload: {
        mode: "personal",
        groupId: null,
        title: "我的网盘",
        canManage: true,
      },
    }).catch((error) => {
      setDataSource((current) => ({ ...current, error: friendlyError(String(error)) }));
    });
  };

  const refreshDrivePanel = async (
    override?: Partial<Pick<DrivePanelState, "mode" | "groupId" | "breadcrumb" | "search" | "filter">>,
  ) => {
    const snapshot = {
      ...drivePanelRef.current,
      ...override,
    };
    const parent = snapshot.breadcrumb?.[snapshot.breadcrumb.length - 1] ?? null;
    setDrivePanel((current) => ({ ...current, loading: true, error: null }));
    try {
      const nodes = await listDriveNodes({
        driveType: snapshot.mode,
        groupId: snapshot.groupId ?? null,
        parentId: parent?.id ?? null,
        keyword: snapshot.search,
        fileType: driveFilterToApiType(snapshot.filter),
      });
      setDrivePanel((current) => ({
        ...current,
        ...override,
        nodes,
        loading: false,
        error: null,
        selectedIds: [],
      }));
    } catch (error) {
      setDrivePanel((current) => ({
        ...current,
        ...override,
        loading: false,
        error: friendlyError(String(error)),
      }));
    }
  };

  const createFolderInDrive = async () => {
    const name = window.prompt("新建文件夹名称", "新建文件夹")?.trim();
    if (!name) {
      return;
    }
    const parent = drivePanel.breadcrumb[drivePanel.breadcrumb.length - 1] ?? null;
    try {
      await createDriveFolder({
        driveType: drivePanel.mode,
        groupId: drivePanel.groupId ?? null,
        parentId: parent?.id ?? null,
        name,
      });
      await refreshDrivePanel();
    } catch (error) {
      setDrivePanel((current) => ({
        ...current,
        error: friendlyError(String(error)),
      }));
    }
  };

  const uploadFilesToDrive = async () => {
    try {
      const files = await pickChatUploadFiles({ kind: "file", multiple: true });
      if (files.length === 0) {
        return;
      }
      const parent = drivePanel.breadcrumb[drivePanel.breadcrumb.length - 1] ?? null;
      for (const file of files) {
        const uploaded = await uploadChatFilePathChunked({
          filePath: file.path,
          fileType: normalizeLocalUploadKind(file),
          contentType: file.contentType,
          chunkSize: DEFAULT_CHAT_CHUNK_SIZE,
          taskId: `drive-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        });
        await saveFileToDrive({
          driveType: drivePanel.mode,
          groupId: drivePanel.groupId ?? null,
          parentId: parent?.id ?? null,
          fileObjectId: uploaded.id,
          name: uploaded.originalName || file.name,
        });
      }
      await refreshDrivePanel();
    } catch (error) {
      setDrivePanel((current) => ({
        ...current,
        error: friendlyError(String(error)),
      }));
    }
  };

  const openDriveNode = async (node: DriveNode) => {
    if (node.type === "folder") {
      const breadcrumb = [...drivePanel.breadcrumb, node];
      setDrivePanel((current) => ({ ...current, breadcrumb }));
      await refreshDrivePanel({ breadcrumb });
      return;
    }
    if (isDriveMediaNode(node)) {
      openDriveMediaViewer(node);
      return;
    }
    if (node.fileObjectId) {
      try {
        await openCachedChatFile(node.fileObjectId, node.name, {
          source: "drive",
          driveNodeId: node.id,
        });
      } catch (error) {
        setDrivePanel((current) => ({
          ...current,
          error: friendlyError(String(error)),
        }));
      }
    }
  };

  const openDriveMediaViewer = (node: DriveNode) => {
    if (!node.fileObjectId) {
      return;
    }
    const visibleDriveNodes = sortDriveNodes(
      filterDriveNodes(drivePanel.nodes, drivePanel.filter),
      drivePanel.sortMode,
    );
    const mediaNodes = visibleDriveNodes.some((item) => item.id === node.id)
      ? visibleDriveNodes
      : [node, ...visibleDriveNodes];
    const driveItems = mediaNodes
      .filter(isDriveMediaNode)
      .map((item): MediaViewerItem => ({
        id: item.id,
        messageId: item.id,
        conversationId: drivePanel.groupId ?? `drive-${drivePanel.mode}`,
        sourceMessageId: null,
        messageFileRefId: null,
        source: drivePanel.mode === "group" ? "group_drive" : "personal_drive",
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
        localCandidates: [],
      }));
    const activeId = node.id;
    const currentIndex = Math.max(0, driveItems.findIndex((item) => item.id === activeId));
    void invoke("open_media_viewer_window", {
      payload: {
        conversationId: drivePanel.groupId ?? `drive-${drivePanel.mode}`,
        conversationTitle: drivePanel.title,
        activeId,
        currentIndex,
        mediaList: driveItems,
      },
    });
  };

  const downloadDriveNode = async (node: DriveNode) => {
    if (node.type !== "file" || !node.fileObjectId) {
      return;
    }
    try {
      await downloadChatFile(node.fileObjectId, node.name, {
        source: "drive",
        driveNodeId: node.id,
      });
    } catch (error) {
      setDrivePanel((current) => ({
        ...current,
        error: friendlyError(String(error)),
      }));
    }
  };

  const navigateDriveBreadcrumb = async (index: number) => {
    const breadcrumb = index < 0 ? [] : drivePanel.breadcrumb.slice(0, index + 1);
    setDrivePanel((current) => ({ ...current, breadcrumb }));
    await refreshDrivePanel({ breadcrumb });
  };

  const forwardDriveNodeToConversation = async (
    nodeId: string,
    conversation: ChatConversation,
  ) => {
    try {
      const message = await forwardDriveNodeToChat(nodeId, conversation.id);
      if (conversation.id === activeConversationIdRef.current) {
        setMessages((current) => mergeMessages(current, [{ ...message, direction: "outgoing" }]));
      }
      setConversations((current) =>
        current.map((item) =>
          item.id === conversation.id
            ? {
                ...item,
                subtitle: messagePreview(message),
                timeLabel: message.timeLabel || item.timeLabel,
              }
            : item,
        ),
      );
      setDriveForwardPicker(null);
    } catch (error) {
      setDataSource((current) => ({ ...current, error: friendlyError(String(error)) }));
    }
  };

  const retryTransferTask = (task: TransferTask) => {
    if (!task.filePath) {
      return;
    }
    void sendLocalUploadFile(
      {
        path: task.filePath,
        name: task.fileName,
        sizeBytes: task.fileSize,
        contentType: task.contentType || "application/octet-stream",
        fileType: task.fileType,
      },
      {
        retryTaskId: task.id,
        localMessageId: task.localMessageId,
        saveToPersonalDrive: task.saveToPersonalDrive,
        saveToGroupDrive: task.saveToGroupDrive,
      },
    );
  };

  const uploadSticker = async (file: File) => {
    if (!file.type || !["image/png", "image/gif", "image/webp"].includes(file.type)) {
      setDataSource((current) => ({
        ...current,
        error: "自定义表情仅支持 PNG / GIF / WebP",
      }));
      return;
    }
    setEmojiPanelOpen(true);
    setEmojiPanelTab("stickers");
    setStickerUploading(true);
    try {
      const uploaded = await uploadChatFileBytes({
        filename: file.name,
        contentType: file.type,
        bytes: await fileToBytes(file),
        fileType: "sticker",
      });
      const sticker: ChatSticker = {
        id: uploaded.id,
        fileObjectId: uploaded.id,
        fileName: uploaded.originalName || file.name || "表情",
        contentType: uploaded.contentType,
        sizeBytes: uploaded.sizeBytes,
        url: uploaded.url || null,
        createdAt: Date.now(),
      };
      setStickers((current) =>
        current.some((item) => item.fileObjectId === sticker.fileObjectId)
          ? current
          : [sticker, ...current],
      );
      setDataSource((current) => ({ ...current, error: null }));
    } catch (error) {
      setDataSource((current) => ({ ...current, error: String(error) }));
    } finally {
      setStickerUploading(false);
    }
  };

  const sendStickerMessage = async (sticker: ChatSticker) => {
    if (!activeConversation) {
      return;
    }
    const quote = quotedMessage;
    const contentJson = withQuoteMeta({
        fileId: sticker.fileObjectId,
        fileName: sticker.fileName,
        sizeBytes: sticker.sizeBytes,
        contentType: sticker.contentType || "image/webp",
        url: null,
    }, quote);
    const localMessage = createLocalMessage(
      "sticker",
      "[表情]",
      contentJson,
      sticker.fileObjectId,
      quote,
    );
    scheduleScrollToLatestSelfMessage(activeConversation.id);
    setMessages((current) => [...current, localMessage]);
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? {
              ...conversation,
              subtitle: "[表情]",
              timeLabel: localMessage.timeLabel ?? conversation.timeLabel,
            }
          : conversation,
      ),
    );
    setEmojiPanelOpen(false);
    setQuotedMessage(null);

    if (!dataSource.live) {
      return;
    }

    const refreshId = chatRefreshSeqRef.current;
    try {
      const saved = await postTypedChatMessage({
        conversationId: activeConversation.id,
        messageType: "sticker",
        content: "[表情]",
        contentJson,
        quoteMeta: quote,
        fileObjectId: sticker.fileObjectId,
      });
      if (refreshId !== chatRefreshSeqRef.current) {
        return;
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === localMessage.id
            ? { ...saved, direction: "outgoing", senderId: currentUserId }
            : item,
        ),
      );
    } catch (error) {
      if (refreshId !== chatRefreshSeqRef.current) {
        return;
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === localMessage.id ? { ...item, status: "failed" } : item,
        ),
      );
      setQuotedMessage((current) => current ?? quote);
      setDataSource((current) => ({ ...current, error: String(error) }));
    }
  };

  const handleStickerSelection = (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) {
      return;
    }
    void uploadSticker(file);
  };

  const loadOlderMessages = async () => {
    if (!activeConversation || activeMessages.length === 0) {
      return;
    }
    const beforeSeq = Math.min(
      ...activeMessages
        .map((message) => message.conversationSeq ?? Number.POSITIVE_INFINITY)
        .filter(Number.isFinite),
    );
    if (!Number.isFinite(beforeSeq) || beforeSeq <= 1) {
      return;
    }
    try {
      const olderMessages = await loadChatMessages(activeConversation.id, {
        beforeSeq,
        limit: 30,
      });
      setHistoryExhaustedMap((current) => ({
        ...current,
        [activeConversation.id]: olderMessages.length < 30,
      }));
      setMessages((current) => mergeMessages(current, olderMessages));
    } catch (error) {
      setDataSource((current) => ({ ...current, error: String(error) }));
    }
  };

  const revokeMessage = async (message: ChatMessage) => {
    if (!message.id || message.id.startsWith("msg-local-")) {
      return;
    }
    try {
      const revoked = await revokeChatMessage(message.id);
      applyRevokedMessage({ ...revoked, direction: "outgoing" });
    } catch (error) {
      setDataSource((current) => ({ ...current, error: String(error) }));
    }
  };

  const openMediaViewerWindow = (message: ChatMessage) => {
    const normalizedClickedMessage = withRememberedLocalMediaPath(message, sentLocalMediaPathRef.current);
    const activeItem = mediaViewerItemFromMessage(normalizedClickedMessage);
    if (!activeItem) {
      setDataSource((current) => ({
        ...current,
        error: "当前视频暂无可播放文件",
      }));
      return;
    }
    const mediaItems = activeMessages
      .filter((item) => isMediaMessage(item) && item.status !== "revoked")
      .map((item) =>
        mediaViewerItemFromMessage(
          withRememberedLocalMediaPath(item, sentLocalMediaPathRef.current),
          item.senderId === currentUserId
            ? "我"
            : profileMap[item.senderId ?? -1]?.nickname ||
                activeConversation?.title ||
                "对方",
        ),
      )
      .filter(Boolean) as MediaViewerItem[];
    const sortedItems = mediaItems.sort(compareMediaViewerItems);
    if (sortedItems.length === 0) {
      return;
    }
    const activeId = activeItem.id;
    const currentIndex = Math.max(0, sortedItems.findIndex((item) => item.id === activeId));
    mediaDebug("ChatWindow openMediaViewerWindow payload", {
      clickedMessageId: normalizedClickedMessage.id,
      activeId,
      currentIndex,
      mediaListLength: sortedItems.length,
      activeItem: {
        source: activeItem.source,
        sourceId: activeItem.sourceId,
        messageFileRefId: activeItem.messageFileRefId,
        fileObjectId: activeItem.fileObjectId,
        localCandidates: activeItem.localCandidates,
      },
    });
    void invoke("open_media_viewer_window", {
      payload: {
        conversationId: activeConversation?.id ?? normalizedClickedMessage.conversationId,
        conversationTitle: activeConversation?.title ?? "",
        activeId,
        currentIndex,
        mediaList: sortedItems,
      },
    }).catch((error) => {
      mediaDebug("ChatWindow openMediaViewerWindow failed", {
        clickedMessageId: message.id,
        error: String(error),
      });
      setDataSource((current) => ({ ...current, error: String(error) }));
    });
  };

  const downloadMessageFile = async (message: ChatMessage) => {
    const fileObjectId = message.fileObjectId || fileObjectIdFromMessage(message);
    if (!fileObjectId) {
      setDataSource((current) => ({
        ...current,
        error: "当前消息暂无可下载文件",
      }));
      return;
    }
    if (isMessageFileDefinitelyUnavailable(message)) {
      setDataSource((current) => ({
        ...current,
        error: chatFileAccessReason(message),
      }));
      return;
    }
    try {
      mediaDebug("ChatWindow downloadMessageFile request", {
        messageId: message.id,
        fileObjectId,
        fileName: fileNameFromMessage(message, "文件"),
        access: chatMessageFileAccessSource(message),
      });
      const result = await downloadChatFile(
        fileObjectId,
        fileNameFromMessage(message, "文件"),
        chatMessageFileAccessSource(message),
      );
      mediaDebug("ChatWindow downloadMessageFile response", {
        messageId: message.id,
        cancelled: result.cancelled ?? false,
        path: result.path ?? null,
      });
      if (!result.cancelled) {
        setDataSource((current) => ({
          ...current,
          error: result.path ? `已下载到 ${result.path}` : null,
        }));
      }
    } catch (error) {
      mediaDebug("ChatWindow downloadMessageFile failed", {
        messageId: message.id,
        error: String(error),
      });
      setDataSource((current) => ({ ...current, error: String(error) }));
    }
  };

  const openChatHistoryWindow = () => {
    if (!displayedActiveConversation) {
      setDataSource((current) => ({
        ...current,
        error: "请先选择一个会话",
      }));
      return;
    }
    void invoke("open_chat_history_window", {
      payload: {
        conversationId: displayedActiveConversation.id,
        conversationTitle: displayedActiveConversation.title,
        currentUserId: Number.isInteger(currentUserId) ? currentUserId : null,
        peerUserId: Number(displayedActiveConversation.participant.id) || null,
      },
    }).catch((error) => {
      setDataSource((current) => ({ ...current, error: String(error) }));
    });
  };

  const openScreenshotTool = () => {
    setScreenshotMenuOpen(false);
    setEmojiPanelOpen(false);
    setMoreMenuOpen(false);
    setAddMenuOpen(false);
    setConversationMenu(null);
    setMessageMenu(null);
    setGroupMemberMenu(null);
    void invoke("open_screenshot_window", {
      options: { hideCurrentWindow: hideChatWhenScreenshot },
    }).catch((error) => {
      setDataSource((current) => ({ ...current, error: String(error) }));
    });
  };

  const locateMessageFromHistory = async (
    conversationId: string,
    messageId: string,
    conversationSeq: number | null,
  ) => {
    selectConversation(conversationId);
    setHighlightMessageId(messageId);

    const scrollToMessage = () => {
      const element = document.querySelector(
        `[data-message-id="${CSS.escape(messageId)}"]`,
      );
      if (element instanceof HTMLElement) {
        element.scrollIntoView({ block: "center", behavior: "smooth" });
        return true;
      }
      return false;
    };

    window.setTimeout(() => {
      if (scrollToMessage()) {
        return;
      }
      if (!conversationSeq) {
        setDataSource((current) => ({
          ...current,
          error: "该消息暂未加载到当前聊天窗口",
        }));
        return;
      }
      setDataSource((current) => ({
        ...current,
        error: "正在加载该位置附近记录...",
      }));
      void loadChatHistoryMessages(conversationId, {
        type: "all",
        aroundSeq: conversationSeq,
        limit: 80,
      })
        .then((nearbyMessages) => {
          setMessages((current) =>
            mergeMessages(current, nearbyMessages.map(normalizeMessageDirection)),
          );
          setDataSource((current) => ({ ...current, error: null }));
          window.setTimeout(() => {
            if (!scrollToMessage()) {
              setDataSource((current) => ({
                ...current,
                error: "暂未定位到该消息",
              }));
            }
          }, 80);
        })
        .catch((error) => {
          setDataSource((current) => ({ ...current, error: String(error) }));
        });
    }, 100);

    window.setTimeout(() => {
      setHighlightMessageId((current) => (current === messageId ? null : current));
    }, 2200);
  };

  const removeMessageLocally = async (messageId: string) => {
    try {
      await deleteChatMessageForMe(messageId);
      setMessages((current) => current.filter((message) => message.id !== messageId));
    } catch (error) {
      setDataSource((current) => ({ ...current, error: String(error) }));
    }
    setMessageMenu(null);
  };

  const startMessageMultiSelect = (message: ChatMessage) => {
    setMultiSelectMode(true);
    setSelectedMessageIds((current) =>
      current.includes(message.id) ? current : [...current, message.id],
    );
    setMessageMenu(null);
  };

  const toggleSelectedMessage = (messageId: string) => {
    setSelectedMessageIds((current) =>
      current.includes(messageId)
        ? current.filter((id) => id !== messageId)
        : [...current, messageId],
    );
  };

  const cancelMultiSelect = () => {
    setMultiSelectMode(false);
    setSelectedMessageIds([]);
  };

  const quoteMessage = (message: ChatMessage) => {
    setQuotedMessage(quoteMetaFromMessage(message, quoteSenderLabel(message)));
    setMessageMenu(null);
    window.requestAnimationFrame(() => {
      draftInputRef.current?.focus();
    });
  };

  const quoteSenderLabel = (message: ChatMessage): string => {
    if (message.direction === "outgoing") {
      return "我";
    }
    if (activeConversation?.kind === "group" && message.senderId) {
      const profile = profileMapRef.current[message.senderId];
      return profile?.nickname || `用户${message.senderId}`;
    }
    return activeConversation?.title || "对方";
  };

  const openForwardPicker = (messageIds: string[]) => {
    const availableIds = messageIds.filter((id) =>
      messagesRef.current.some((message) => message.id === id),
    );
    if (availableIds.length === 0) {
      return;
    }
    setForwardPicker({ messageIds: availableIds });
    setMessageMenu(null);
  };

  const forwardMessagesToConversation = async (targetConversation: ChatConversation) => {
    const sourceMessages = (forwardPicker?.messageIds ?? [])
      .map((id) => messagesRef.current.find((message) => message.id === id))
      .filter(Boolean) as ChatMessage[];
    if (sourceMessages.length === 0) {
      setForwardPicker(null);
      return;
    }
    setDataSource((current) => ({ ...current, error: null }));
    for (const source of sourceMessages) {
      try {
        await forwardSingleMessage(source, targetConversation.id);
      } catch (error) {
        setDataSource((current) => ({ ...current, error: String(error) }));
        break;
      }
    }
    setForwardPicker(null);
    cancelMultiSelect();
  };

  const forwardSingleMessage = async (
    source: ChatMessage,
    targetConversationId: string,
  ) => {
    if (!dataSource.live) {
      throw new Error("云端未连接，暂不能转发");
    }
    if (fileObjectIdFromMessage(source) && !chatFileCloudAvailable(source)) {
      throw new Error(chatFileAccessReason(source));
    }
    await forwardChatMessage(source, targetConversationId);
  };

  const removeSelectedMessagesLocally = () => {
    const selected = new Set(selectedMessageIds);
    setMessages((current) => current.filter((message) => !selected.has(message.id)));
    cancelMultiSelect();
  };

  const handleMessageMenuAction = (
    action: MessageMenuAction,
    message: ChatMessage,
  ) => {
    mediaDebug("ChatWindow message menu action", {
      action,
      messageId: message.id,
      kind: message.kind,
      fileObjectId: message.fileObjectId || fileObjectIdFromMessage(message) || null,
      access: chatMessageFileAccessSource(message) ?? null,
    });
    setMessageMenu(null);
    if (action === "open") {
      void openMessageFile(message);
      return;
    }
    if (action === "play") {
      openMediaViewerWindow(message);
      return;
    }
    if (action === "forward") {
      openForwardPicker([message.id]);
      return;
    }
    if (action === "multi-select") {
      startMessageMultiSelect(message);
      return;
    }
    if (action === "quote") {
      quoteMessage(message);
      return;
    }
    if (action === "revoke") {
      void revokeMessage(message);
      return;
    }
    if (action === "delete") {
      void removeMessageLocally(message.id);
      return;
    }
    if (action === "download") {
      void downloadMessageFile(message);
      return;
    }
    if (action === "save-personal-drive") {
      void saveMessageFileToDrive(message, "personal");
      return;
    }
    if (action === "save-group-drive") {
      void saveMessageFileToDrive(message, "group");
      return;
    }
    if (action === "copy-file-name") {
      void navigator.clipboard?.writeText(fileNameFromMessage(message, "文件"));
      return;
    }
  };

  const displayedFriends = friends.map(
    (friend) => profileMap[friend.userId] ?? friend,
  );
  const groupContacts = useMemo(
    () =>
      conversations
        .filter((conversation) => conversation.kind === "group" && conversation.groupId)
        .sort((left, right) => {
          const leftName = groupMap[left.groupId as string]?.name || left.title;
          const rightName = groupMap[right.groupId as string]?.name || right.title;
          return leftName.localeCompare(rightName, "zh-Hans-CN");
        }),
    [conversations, groupMap],
  );
  const shareRecipients: ShareCardRecipient[] = [
    ...displayedFriends
      .filter((friend) => friend.userId !== currentUserId)
      .map((friend) => {
        const directConversation = conversations.find(
          (conversation) =>
            conversation.kind === "direct" &&
            Number(conversation.participant.id) === friend.userId,
        );
        return {
          key: `friend:${friend.userId}`,
          kind: "friend" as const,
          id: String(friend.userId),
          conversationId: directConversation?.id ?? null,
          title: friend.nickname || `用户${friend.userId}`,
          subtitle: friend.bio || "好友",
          avatarLabel: profileInitial(friend),
          avatarUrl: friend.avatarUrl ?? null,
        };
      }),
    ...groupContacts.map((conversation) => {
      const groupId = conversation.groupId as string;
      const group = groupMap[groupId] ?? null;
      const title = group?.name || conversation.title || "群聊";
      return {
        key: `group:${groupId}`,
        kind: "group" as const,
        id: groupId,
        conversationId: conversation.id,
        title,
        subtitle: `${group?.memberCount ?? conversation.groupMemberCount ?? 0} 人`,
        avatarLabel: title.slice(0, 1),
        avatarUrl: groupDisplayAvatarUrl(group, conversation),
      };
    }),
  ];

  const shareSubjectFromProfile = (profile: UserProfile): ShareCardSubject => ({
    kind: "contact",
    id: String(profile.userId),
    title: profile.nickname || `用户${profile.userId}`,
    subtitle: profile.bio || "好友名片",
    avatarUrl: profile.avatarUrl ?? null,
    avatarObjectKey: profile.avatarObjectKey ?? null,
    description: profile.bio ?? null,
  });

  const shareSubjectFromGroup = (group: GroupProfileSnapshot): ShareCardSubject => ({
    kind: "group",
    id: group.id,
    title: group.name || "群聊",
    subtitle: group.memberCount ? `${group.memberCount} 人` : "群名片",
    avatarUrl: group.avatarUrl ?? null,
    avatarObjectKey: group.avatarObjectKey ?? null,
    description: group.description ?? group.announcement ?? null,
    memberCount: group.memberCount ?? null,
    conversationId: group.conversationId ?? null,
  });

  const groupSnapshotFromGroup = (
    group: ChatGroup | null,
    conversation: ChatConversation,
  ): GroupProfileSnapshot =>
    group
      ? groupSnapshotFromConversation(conversation, group)
      : {
          id: conversation.groupId || conversation.id,
          groupNo: null,
          conversationId: conversation.id,
          name: conversation.title || "群聊",
          avatarUrl: groupDisplayAvatarUrl(group, conversation),
          avatarObjectKey: conversation.groupAvatarObjectKey ?? null,
          description: conversation.subtitle || null,
          announcement: null,
          memberCount: conversation.groupMemberCount ?? null,
        };

  const buildGroupSharePayload = (
    group: GroupProfileSnapshot,
    invite: ChatGroupInvite,
  ): Record<string, unknown> => ({
    cardType: "group_share",
    groupId: group.id,
    groupNo: group.groupNo ?? formatGroupNo(group),
    conversationId: group.conversationId ?? invite.group.conversationId ?? null,
    name: invite.group.name || group.name,
    title: invite.group.name || group.name,
    avatarUrl: invite.group.avatarUrl ?? group.avatarUrl ?? null,
    avatarObjectKey: invite.group.avatarObjectKey ?? group.avatarObjectKey ?? null,
    description: invite.group.description ?? group.description ?? null,
    memberCount: invite.group.memberCount ?? group.memberCount ?? null,
    inviteToken: invite.inviteToken,
    inviteUrl: invite.inviteUrl,
    expireAt: invite.expireAt ?? null,
  });

  const createGroupShareQr = async (inviteUrl: string): Promise<string> =>
    QRCode.toDataURL(inviteUrl, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 256,
      color: {
        dark: "#1677ff",
        light: "#ffffff",
      },
    });

  const openGroupShareDialog = (group: GroupProfileSnapshot) => {
    closeProfileCard();
    setGroupShareDialog({
      group,
      invite: null,
      qrDataUrl: null,
      loading: true,
      saving: false,
      forwarding: false,
      error: null,
    });
    void createChatGroupInvite({ groupId: group.id, scene: "qr_modal" })
      .then(async (invite) => {
        const qrDataUrl = await createGroupShareQr(invite.inviteUrl);
        setGroupShareDialog((current) =>
          current?.group.id === group.id
            ? {
                ...current,
                group: {
                  ...current.group,
                  name: invite.group.name || current.group.name,
                  avatarUrl: invite.group.avatarUrl ?? current.group.avatarUrl,
                  avatarObjectKey:
                    invite.group.avatarObjectKey ?? current.group.avatarObjectKey,
                  description: invite.group.description ?? current.group.description,
                  groupNo: invite.group.groupNo ?? current.group.groupNo ?? null,
                  memberCount: invite.group.memberCount ?? current.group.memberCount,
                },
                invite,
                qrDataUrl,
                loading: false,
                error: null,
              }
            : current,
        );
      })
      .catch((error) => {
        setGroupShareDialog((current) =>
          current?.group.id === group.id
            ? {
                ...current,
                loading: false,
                error: friendlyError(String(error)),
              }
            : current,
        );
      });
  };

  const openShareCardDialog = (subject: ShareCardSubject) => {
    closeProfileCard();
    setShareCard({
      subject,
      selectedKeys: [],
      search: "",
      note: "",
      sending: false,
      error: null,
    });
  };

  const updateShareCard = (
    updater: (current: NonNullable<ShareCardDialogState>) => NonNullable<ShareCardDialogState>,
  ) => {
    setShareCard((current) => (current ? updater(current) : current));
  };

  const toggleShareRecipient = (key: string) => {
    updateShareCard((current) => {
      const selected = current.selectedKeys.includes(key);
      if (!selected && current.selectedKeys.length >= 9) {
        return { ...current, error: "一次最多分享给 9 个会话" };
      }
      return {
        ...current,
        error: null,
        selectedKeys: selected
          ? current.selectedKeys.filter((item) => item !== key)
          : [...current.selectedKeys, key],
      };
    });
  };

  const appendOutgoingMessage = (message: ChatMessage) => {
    const outgoing = {
      ...message,
      direction: "outgoing" as const,
      senderId: currentUserId,
    };
    setMessages((current) => mergeMessages(current, [outgoing]));
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === outgoing.conversationId
          ? {
              ...conversation,
              subtitle: messagePreview(outgoing),
              timeLabel: outgoing.timeLabel || conversation.timeLabel,
            }
          : conversation,
      ),
    );
    if (activeConversationIdRef.current === outgoing.conversationId) {
      scheduleScrollToLatestSelfMessage(outgoing.conversationId);
    }
  };

  const openMessageFile = async (message: ChatMessage) => {
    const fileObjectId = message.fileObjectId || fileObjectIdFromMessage(message);
    if (!fileObjectId) {
      setDataSource((current) => ({ ...current, error: "当前消息暂无可打开文件" }));
      return;
    }
    if (!chatFileCloudAvailable(message)) {
      setDataSource((current) => ({ ...current, error: chatFileAccessReason(message) }));
      return;
    }
    try {
      await openCachedChatFile(
        fileObjectId,
        fileNameFromMessage(message, "文件"),
        chatMessageFileAccessSource(message),
      );
    } catch (error) {
      setDataSource((current) => ({ ...current, error: friendlyError(String(error)) }));
    }
  };

  const saveMessageFileToDrive = async (
    message: ChatMessage,
    driveType: "personal" | "group",
  ) => {
    const fileObjectId = message.fileObjectId || fileObjectIdFromMessage(message);
    if (!fileObjectId) {
      setDataSource((current) => ({ ...current, error: "当前消息暂无可保存文件" }));
      return;
    }
    if (!chatFileCloudAvailable(message)) {
      setDataSource((current) => ({ ...current, error: chatFileAccessReason(message) }));
      return;
    }
    const groupId =
      driveType === "group" ? displayedActiveConversation?.groupId ?? null : null;
    try {
      const node = await saveFileToDrive({
        driveType,
        groupId,
        parentId: null,
        fileObjectId,
        sourceMessageId: officialChatMessageId(message),
        name: fileNameFromMessage(message, "文件"),
      });
      setDriveSaveNotice({
        id: node.id,
        label: driveType === "group" ? "已存入群网盘" : "已存入我的网盘",
      });
      window.setTimeout(() => setDriveSaveNotice(null), 2200);
      if (
        drivePanelRef.current.open &&
        drivePanelRef.current.mode === driveType &&
        (driveType === "personal" || drivePanelRef.current.groupId === groupId)
      ) {
        void refreshDrivePanel();
      }
    } catch (error) {
      setDataSource((current) => ({ ...current, error: friendlyError(String(error)) }));
    }
  };

  const resolveShareTargetConversation = async (
    recipient: ShareCardRecipient,
  ): Promise<string> => {
    if (recipient.kind === "group") {
      if (!recipient.conversationId) {
        throw new Error("暂未找到该群会话");
      }
      return recipient.conversationId;
    }
    if (recipient.conversationId) {
      return recipient.conversationId;
    }
    const userId = Number(recipient.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("好友信息无效");
    }
    const conversation = await createDirectConversation(userId);
    const displayedConversation = mergeProfileIntoConversation(
      conversation,
      friendProfileFromKnownState(userId),
    );
    setConversations((current) =>
      upsertConversation(current, displayedConversation),
    );
    return displayedConversation.id;
  };

  const shareContentJson = (subject: ShareCardSubject): Record<string, unknown> => {
    if (subject.kind === "contact") {
      return {
        cardType: "contact",
        userId: Number(subject.id),
        nickname: subject.title,
        title: subject.title,
        avatarUrl: subject.avatarUrl ?? null,
        avatarObjectKey: subject.avatarObjectKey ?? null,
        bio: subject.description ?? subject.subtitle ?? null,
      };
    }
    return {
      cardType: "group",
      groupId: subject.id,
      conversationId: subject.conversationId ?? null,
      name: subject.title,
      title: subject.title,
      avatarUrl: subject.avatarUrl ?? null,
      avatarObjectKey: subject.avatarObjectKey ?? null,
      description: subject.description ?? null,
      memberCount: subject.memberCount ?? null,
      ...(subject.invite
        ? {
            cardType: "group_share",
            inviteToken: subject.invite.inviteToken,
            inviteUrl: subject.invite.inviteUrl,
            expireAt: subject.invite.expireAt ?? null,
          }
        : {}),
    };
  };

  const sendShareCard = async () => {
    if (!shareCard || shareCard.sending) {
      return;
    }
    if (!dataSource.live) {
      updateShareCard((current) => ({ ...current, error: "云端未连接，暂不能分享" }));
      return;
    }
    const recipients = shareCard.selectedKeys
      .map((key) => shareRecipients.find((recipient) => recipient.key === key))
      .filter(Boolean) as ShareCardRecipient[];
    if (recipients.length === 0) {
      updateShareCard((current) => ({ ...current, error: "请选择要分享的会话" }));
      return;
    }
    updateShareCard((current) => ({ ...current, sending: true, error: null }));
    try {
      const note = shareCard.note.trim();
      const cardMessageType =
        shareCard.subject.kind === "contact"
          ? "contact_card"
          : shareCard.subject.invite
            ? "group_share_card"
            : "group_card";
      const cardPayload = shareContentJson(shareCard.subject);
      for (const recipient of recipients) {
        const conversationId = await resolveShareTargetConversation(recipient);
        if (note) {
          const savedNote = await postTypedChatMessage({
            conversationId,
            messageType: "text",
            content: note,
          });
          appendOutgoingMessage(savedNote);
        }
        const savedCard = await postTypedChatMessage({
          conversationId,
          messageType: cardMessageType,
          content: shareCard.subject.title,
          contentJson: cardPayload,
        });
        appendOutgoingMessage(savedCard);
      }
      setShareCard(null);
      if (shareCard.subject.invite) {
        setGroupShareDialog(null);
      }
    } catch (error) {
      updateShareCard((current) => ({
        ...current,
        sending: false,
        error: friendlyError(String(error)),
      }));
    }
  };

  const forwardGroupShareCard = () => {
    if (!groupShareDialog?.invite) {
      return;
    }
    const currentGroupShare = groupShareDialog;
    const invite = currentGroupShare.invite!;
    setGroupShareDialog(null);
    setShareCard({
      subject: {
        kind: "group",
        id: currentGroupShare.group.id,
        title: invite.group.name || currentGroupShare.group.name,
        subtitle: invite.group.memberCount
          ? `${invite.group.memberCount} 人`
          : "群分享",
        avatarUrl:
          invite.group.avatarUrl ?? currentGroupShare.group.avatarUrl ?? null,
        avatarObjectKey:
          invite.group.avatarObjectKey ??
          currentGroupShare.group.avatarObjectKey ??
          null,
        description:
          invite.group.description ??
          currentGroupShare.group.description ??
          null,
        memberCount:
          invite.group.memberCount ??
          currentGroupShare.group.memberCount ??
          null,
        conversationId:
          currentGroupShare.group.conversationId ??
          invite.group.conversationId ??
          null,
        invite,
      },
      selectedKeys: [],
      search: "",
      note: "",
      sending: false,
      error: null,
    });
  };

  const saveGroupSharePoster = async () => {
    if (
      !groupShareDialog ||
      !groupShareDialog.invite ||
      !groupShareDialog.qrDataUrl ||
      groupShareDialog.saving
    ) {
      return;
    }
    setGroupShareDialog((current) =>
      current ? { ...current, saving: true, error: null } : current,
    );
    try {
      const pngBytes = await renderGroupSharePosterPng(
        groupShareDialog.group,
        groupShareDialog.invite,
        groupShareDialog.qrDataUrl,
      );
      const fileName = groupSharePosterFileName(
        groupShareDialog.invite.group.name || groupShareDialog.group.name,
        groupShareDialog.group.id,
      );
      const result = await invoke<{ path?: string | null; cancelled?: boolean }>(
        "save_group_share_poster_png",
        { pngBytes: Array.from(pngBytes), fileName },
      );
      setGroupShareDialog((current) =>
        current ? { ...current, saving: false } : current,
      );
      if (!result.cancelled) {
        setDataSource((current) => ({ ...current, error: "图片已保存" }));
      }
    } catch (error) {
      setGroupShareDialog((current) =>
        current
          ? {
              ...current,
              saving: false,
              error: friendlyError(String(error)),
            }
          : current,
      );
    }
  };

  const openFriendFromCardMessage = (message: ChatMessage) => {
    const payload = message.contentJson ?? {};
    const userId = Number(payload.userId ?? payload.targetUserId ?? payload.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return;
    }
    showFriendProfileCard(userId, null, "pinned", {
      nickname:
        typeof payload.nickname === "string"
          ? payload.nickname
          : typeof payload.title === "string"
            ? payload.title
            : message.content,
      avatarUrl: typeof payload.avatarUrl === "string" ? payload.avatarUrl : null,
      avatarObjectKey:
        typeof payload.avatarObjectKey === "string" ? payload.avatarObjectKey : null,
      bio: typeof payload.bio === "string" ? payload.bio : null,
    });
  };

  const openGroupFromCardMessage = (message: ChatMessage) => {
    const payload = message.contentJson ?? {};
    const groupId = String(payload.groupId ?? payload.id ?? "").trim();
    if (!groupId) {
      return;
    }
    const inviteToken =
      typeof payload.inviteToken === "string" ? payload.inviteToken.trim() : "";
    const joinedConversation =
      conversationsRef.current.find(
        (conversation) =>
          conversation.kind === "group" && conversation.groupId === groupId,
      ) ?? null;
    const knownGroup = groupMapRef.current[groupId] ?? null;
    const name =
      knownGroup?.name ||
      (typeof payload.name === "string" ? payload.name : "") ||
      (typeof payload.title === "string" ? payload.title : "") ||
      message.content ||
      "群聊";
    const fallbackSnapshot: GroupProfileSnapshot = joinedConversation
      ? {
          ...groupSnapshotFromConversation(joinedConversation, knownGroup),
          inviteToken: inviteToken || null,
        }
      : {
          id: groupId,
          conversationId:
            typeof payload.conversationId === "string"
              ? payload.conversationId
              : null,
          groupNo:
            typeof payload.groupNo === "string"
              ? payload.groupNo
              : knownGroup?.groupNo ?? null,
          name,
          avatarUrl:
            knownGroup?.avatarUrl ||
            (typeof payload.avatarUrl === "string" ? payload.avatarUrl : null),
          avatarObjectKey:
            knownGroup?.avatarObjectKey ||
            (typeof payload.avatarObjectKey === "string"
              ? payload.avatarObjectKey
              : null),
          description:
            knownGroup?.description ||
            (typeof payload.description === "string" ? payload.description : null),
          announcement: knownGroup?.announcement ?? null,
          memberCount:
            typeof payload.memberCount === "number"
              ? payload.memberCount
              : knownGroup?.memberCount ?? null,
          inviteToken: inviteToken || null,
        };
    if (!inviteToken || joinedConversation) {
      showGroupProfileCard(fallbackSnapshot, null, "pinned");
      return;
    }
    setDataSource((current) => ({ ...current, error: null }));
    void getChatGroupInvite(inviteToken)
      .then((invite) => {
        if (!invite.valid) {
          setDataSource((current) => ({
            ...current,
            error: invite.reason || "该邀请已失效",
          }));
          return;
        }
        applyGroupToChatState(invite.group, null);
        showGroupProfileCard(
          {
            id: invite.group.id,
            groupNo: invite.group.groupNo ?? fallbackSnapshot.groupNo ?? null,
            conversationId: invite.group.conversationId,
            name: invite.group.name,
            avatarUrl: invite.group.avatarUrl ?? fallbackSnapshot.avatarUrl ?? null,
            avatarObjectKey:
              invite.group.avatarObjectKey ?? fallbackSnapshot.avatarObjectKey ?? null,
            description: invite.group.description ?? fallbackSnapshot.description ?? null,
            announcement: invite.group.announcement ?? null,
            memberCount: invite.group.memberCount ?? fallbackSnapshot.memberCount ?? null,
            inviteToken,
          },
          null,
          "pinned",
        );
      })
      .catch((error) => {
        setDataSource((current) => ({
          ...current,
          error: friendlyError(String(error)),
        }));
        showGroupProfileCard(fallbackSnapshot, null, "pinned");
      });
  };

  const sendMessageToProfile = (profile: UserProfile) => {
    closeProfileCard();
    void openDirectConversation(profile.userId);
  };

  const openFriendRequestFromProfile = (profile: UserProfile) => {
    closeProfileCard();
    void invoke("open_friend_request_window", { userId: profile.userId });
  };

  const sendMessageToGroup = (group: GroupProfileSnapshot) => {
    const conversation = conversationsRef.current.find(
      (item) => item.kind === "group" && item.groupId === group.id,
    );
    if (!conversation) {
      return;
    }
    closeProfileCard();
    selectConversation(conversation.id);
    setActiveSection("messages");
  };

  const openGroupMemberDetails = (group: GroupProfileSnapshot) => {
    const conversation = conversationsRef.current.find(
      (item) => item.kind === "group" && item.groupId === group.id,
    );
    if (!conversation) {
      return;
    }
    closeProfileCard();
    setGroupOverviewHidden(false);
    selectConversation(conversation.id);
    setActiveSection("messages");
    void refreshActiveGroupMembers(conversation).catch(() => undefined);
  };

  const requestJoinGroupFromProfile = async (group: GroupProfileSnapshot) => {
    try {
      if (group.inviteToken) {
        const result = await applyChatGroupInvite({
          inviteToken: group.inviteToken,
          reason: "",
        });
        if (result.status === "joined" && result.group && result.conversation) {
          applyGroupToChatState(result.group, result.conversation);
          setConversations((current) =>
            upsertConversation(current, result.conversation as ChatConversation),
          );
          syncPinnedGroupProfileCardState(group.id, {
            membership: "joined",
            loading: false,
            membersLoading: true,
          });
          void refreshActiveGroupMembers(result.conversation).catch(() => undefined);
          setDataSource((current) => ({ ...current, error: "已加入群聊" }));
          return;
        }
        if (result.request) {
          const displayRequest = normalizeGroupRequestProfiles(result.request);
          setGroupRequests((current) => upsertGroupRequest(current, displayRequest));
          syncPinnedGroupProfileCardState(group.id, {
            membership: "pending",
            loading: false,
            membersLoading: false,
            members: [],
          });
          setDataSource((current) => ({ ...current, error: "已发送入群申请" }));
          void refreshContacts({ silent: true }).catch(() => undefined);
          return;
        }
      }
      const saved = await sendChatGroupJoinRequest({ groupId: group.id, message: "" });
      const displayRequest = normalizeGroupRequestProfiles(saved);
      setGroupRequests((current) => upsertGroupRequest(current, displayRequest));
      syncPinnedGroupProfileCardState(group.id, {
        membership: "pending",
        loading: false,
        membersLoading: false,
        members: [],
      });
      setDataSource((current) => ({ ...current, error: "已发送入群申请" }));
      void refreshContacts({ silent: true }).catch(() => undefined);
    } catch (error) {
      setDataSource((current) => ({ ...current, error: friendlyError(String(error)) }));
    }
  };

  const activeContactProfile =
    activeContactUserId !== null
      ? displayedFriends.find((friend) => friend.userId === activeContactUserId) ??
        profileMap[activeContactUserId] ??
        null
      : null;
  const activeContactGroupConversation =
    activeContactGroupId !== null
      ? groupContacts.find(
          (conversation) => conversation.groupId === activeContactGroupId,
        ) ?? null
      : null;
  const activeContactGroup =
    activeContactGroupId !== null ? groupMap[activeContactGroupId] ?? null : null;
  const activeContactGroupMembers =
    activeContactGroupId !== null ? groupMembersMap[activeContactGroupId] ?? [] : [];
  const activeContactGroupLoading =
    activeContactGroupId !== null ? Boolean(groupLoadingMap[activeContactGroupId]) : false;
  const activeContactGroupMembership =
    activeContactGroupId !== null
      ? groupMembershipStateFor(activeContactGroupId)
      : "not_joined";
  const pendingIncomingRequestCount = friendRequests.filter((request) =>
    isIncomingPendingRequest(request, currentUserId),
  ).length;
  const pendingGroupRequestCount = groupRequests.filter((request) =>
    isPendingGroupRequest(request),
  ).length;
  const contactNoticeCount = pendingIncomingRequestCount + pendingGroupRequestCount;
  const activeTransferTasks = transferTasks.filter(
    (task) =>
      !displayedActiveConversation ||
      !task.conversationId ||
      task.conversationId === displayedActiveConversation.id,
  );
  const activeTransferBusyCount = activeTransferTasks.filter((task) =>
    ["waiting", "hashing", "uploading", "downloading", "paused"].includes(task.status),
  ).length;
  const activeTransferFailed = activeTransferTasks.some(
    (task) => task.status === "failed",
  );
  const chatShellStyle = {
    "--chat-list-width": `${chatListWidth}px`,
  } as CSSProperties;
  const chatMainPanelStyle = {
    "--chat-composer-height": `${composerHeight}px`,
  } as CSSProperties;

  return (
    <main className="chat-window-root" onClick={closeContextMenus}>
      <ChatTitleBar />
      <section className="chat-shell" ref={chatShellRef} style={chatShellStyle}>
        <aside className="chat-nav">
          <button
            type="button"
            className="chat-nav-profile"
            title="个人资料"
            onClick={(event) => {
              event.stopPropagation();
              openProfileEditWindow();
            }}
          >
            <Avatar
              label={avatarLabel(myProfile, "我")}
              imageUrl={myProfile?.avatarUrl}
              tone="self"
            />
            <span className="presence-dot online" />
          </button>

          <button
            className={`chat-nav-item ${activeSection === "messages" ? "is-active" : ""}`}
            type="button"
            title="消息"
            onClick={(event) => {
              event.stopPropagation();
              switchSection("messages");
            }}
          >
            <ChatIcon name="message" className="nav-symbol" />
            <span>消息</span>
            {totalUnreadCount > 0 ? (
              <i>{totalUnreadCount > 99 ? "99+" : totalUnreadCount}</i>
            ) : null}
          </button>
          <button
            className={`chat-nav-item ${activeSection === "contacts" ? "is-active" : ""}`}
            type="button"
            title="好友"
            onClick={(event) => {
              event.stopPropagation();
              switchSection("contacts");
            }}
          >
            <ChatIcon name="users" className="nav-symbol" />
            <span>好友</span>
            {contactNoticeCount > 0 ? (
              <i>
                {contactNoticeCount > 99
                  ? "99+"
                  : contactNoticeCount}
              </i>
            ) : null}
          </button>
          <button
            className="chat-nav-item"
            type="button"
            title="网盘"
            onClick={(event) => {
              event.stopPropagation();
              openPersonalDriveWindow();
            }}
          >
            <ChatIcon name="folder" className="nav-symbol" />
            <span>网盘</span>
          </button>

          <div className="chat-nav-spacer" />
          <div className="chat-more-wrap">
            <button
              className="chat-more-button"
              type="button"
              title="更多"
              onClick={(event) => {
                event.stopPropagation();
                setMoreMenuOpen((open) => !open);
                setConversationMenu(null);
              }}
            >
              <ChatIcon name="menu" />
            </button>
            {moreMenuOpen ? (
              <div className="chat-more-menu" onClick={(event) => event.stopPropagation()}>
                <button type="button">设置</button>
                <button type="button" className="danger">退出</button>
              </div>
            ) : null}
          </div>
        </aside>

        <aside className="chat-list-panel" ref={chatListPanelRef}>
          <ChatDataSourceBanner
            dataSource={dataSource}
            accountState={accountState}
          />
          {activeSection === "messages" ? (
            <>
              <div className="chat-search-row">
                <label className="chat-search">
                  <ChatIcon name="search" />
                  <input placeholder="搜索联系人、群聊、功能" />
                </label>
                <button
                  type="button"
                  className="chat-add-button"
                  title="添加"
                  onClick={(event) => {
                    event.stopPropagation();
                    setAddMenuOpen((open) => !open);
                    setMoreMenuOpen(false);
                    setConversationMenu(null);
                  }}
                >
                  <ChatIcon name="plus" />
                </button>
                {addMenuOpen ? (
                  <div
                    className="chat-add-menu"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button type="button" onClick={openProfileSearchWindow}>
                      添加好友/群
                    </button>
                    <button type="button" onClick={openClassAccountEditWindow}>
                      申请班级账号
                    </button>
                    <button
                      type="button"
                      onClick={() => openCreateGroupDialog("normal")}
                    >
                      创建群聊
                    </button>
                    <button
                      type="button"
                      onClick={() => openCreateGroupDialog("class")}
                    >
                      创建班级群
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="chat-conversation-list">
                {sortedConversations.length > 0 ? (
                  sortedConversations.map((conversation) => {
                    const displayedConversation = withProfile(
                      conversation,
                      profileMap,
                    );
                    const conversationGroup =
                      conversation.kind === "group" && conversation.groupId
                        ? groupMap[conversation.groupId] ?? null
                        : null;
                    return (
                      <button
                        key={conversation.id}
                        type="button"
                        className={`conversation-card ${
                          conversation.id === activeConversation?.id
                            ? "is-active"
                            : ""
                        }`}
                        onClick={() => selectConversation(conversation.id)}
                        onContextMenu={(event) =>
                          openConversationMenu(event, conversation.id)
                        }
                      >
                        <span
                          className="avatar-hover-anchor"
                          onMouseEnter={(event) => {
                            if (displayedConversation.kind === "group") {
                              scheduleGroupProfileCard(
                                groupSnapshotFromConversation(
                                  displayedConversation,
                                  conversationGroup,
                                ),
                                event.currentTarget,
                              );
                              return;
                            }
                            const userId = Number(displayedConversation.participant.id);
                            if (Number.isInteger(userId) && userId > 0) {
                              scheduleFriendProfileCard(userId, event.currentTarget, {
                                nickname: displayedConversation.title,
                                avatarUrl: displayedConversation.participant.avatarUrl,
                                accountType: displayedConversation.participant.accountType ?? undefined,
                                classNo: displayedConversation.participant.classNo ?? null,
                              });
                            }
                          }}
                          onMouseLeave={scheduleProfileCardHide}
                        >
                          <Avatar
                            label={displayedConversation.participant.avatar}
                            imageUrl={displayedConversation.participant.avatarUrl}
                            tone={conversation.kind}
                          />
                        </span>
                        <span
                          className={`presence-dot ${displayedConversation.participant.presence}`}
                        />
                        <span className="conversation-main">
                          <span className="conversation-title-row">
                            <strong>{displayedConversation.title}</strong>
                            {displayedConversation.kind === "direct" &&
                            displayedConversation.participant.accountType === "class" ? (
                              <ClassBadge label="班" />
                            ) : null}
                            {displayedConversation.kind === "group" &&
                            ((conversationGroup?.groupType ?? displayedConversation.groupType) === "class") ? (
                              <ClassBadge label="班级群" />
                            ) : null}
                            {conversation.pinned ? <em>置顶</em> : null}
                          </span>
                          <span className="conversation-subtitle">
                            {conversation.subtitle}
                          </span>
                        </span>
                        <span className="conversation-meta">
                          <span>{conversation.timeLabel}</span>
                          {conversation.unreadCount > 0 ? (
                            <i>
                              {conversation.unreadCount > 99
                                ? "99+"
                                : conversation.unreadCount}
                            </i>
                          ) : null}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <ConversationEmptyState
                    dataSource={dataSource}
                    accountState={accountState}
                    onAddFriend={openProfileSearchWindow}
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <div className="chat-search-row">
                <label className="chat-search">
                  <ChatIcon name="search" />
                  <input placeholder="搜索好友、群聊" readOnly />
                </label>
                <button
                  type="button"
                  className="chat-add-button"
                  title="添加好友"
                  onClick={(event) => {
                    event.stopPropagation();
                    openProfileSearchWindow();
                  }}
                >
                  <ChatIcon name="plus" />
                </button>
              </div>
              <ContactList
                friends={displayedFriends}
                groups={groupContacts}
                groupsById={groupMap}
                requests={friendRequests}
                groupRequests={groupRequests}
                currentUserId={currentUserId}
                activeTab={contactListTab}
                activeUserId={activeContactUserId}
                activeGroupId={activeContactGroupId}
                activeView={contactDetailView}
                loading={contactsLoading}
                error={contactsError}
                onChangeTab={changeContactListTab}
                onOpenFriendRequests={openFriendRequests}
                onOpenGroupRequests={openGroupRequests}
                onSelectFriend={selectFriendContact}
                onSelectGroup={selectGroupContact}
                onFriendAvatarHover={(profile, element) =>
                  scheduleFriendProfileCard(profile.userId, element, profile)
                }
                onGroupAvatarHover={(conversation, element) =>
                  scheduleGroupProfileCard(
                    groupSnapshotFromConversation(
                      conversation,
                      conversation.groupId ? groupMap[conversation.groupId] ?? null : null,
                    ),
                    element,
                  )
                }
                onAvatarLeave={scheduleProfileCardHide}
                onAddFriend={openProfileSearchWindow}
                onAddGroup={openProfileSearchWindow}
              />
            </>
          )}
        </aside>

        <div
          className="chat-column-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整中间栏宽度"
          onPointerDown={startChatListResize}
        />

        {activeSection === "messages" ? (
          displayedActiveConversation ? (
            <section
              className="chat-main-panel"
              ref={chatMainPanelRef}
              style={chatMainPanelStyle}
            >
              <header className="chat-contact-header">
                <div className="chat-contact-info">
                  {displayedActiveConversation.kind === "group" ? (
                    <div className="chat-title-inline">
                      {groupTitleEditing ? (
                        <input
                          value={groupTitleDraft}
                          maxLength={80}
                          autoFocus
                          disabled={groupTitleSaving}
                          onChange={(event) => setGroupTitleDraft(event.target.value)}
                          onBlur={() => void saveGroupTitleEdit()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void saveGroupTitleEdit();
                            }
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelGroupTitleEdit();
                            }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="chat-title-button"
                          title="双击编辑群名称"
                          onDoubleClick={openGroupTitleEdit}
                        >
                          {activeGroup?.name || displayedActiveConversation.title}
                        </button>
                      )}
                      <span>
                        ({activeGroup?.memberCount ?? displayedActiveConversation.groupMemberCount ?? activeGroupMembers.length})
                      </span>
                    </div>
                  ) : (
                    <div className="chat-title-inline">
                      <button
                        type="button"
                        className="chat-title-button"
                        onClick={() => openFriendProfileWindow(displayedActiveConversation)}
                      >
                        {displayedActiveConversation.title}
                      </button>
                    </div>
                  )}
                </div>
                <div className="chat-action-bar">
                  <button
                    type="button"
                    title="打开 RTC 基础设施测试"
                    onClick={openRtcTestPanel}
                  >
                    <ChatIcon name="mic" />
                    <span>对讲</span>
                  </button>
                  <button
                    type="button"
                    className={activeTransferFailed ? "has-transfer-error" : ""}
                    title="当前会话传输"
                    onClick={() => setTransferDrawerOpen(true)}
                  >
                    <span className="chat-transfer-icon">⇅</span>
                    <span>
                      传输{activeTransferBusyCount > 0 ? ` ${activeTransferBusyCount}` : ""}
                    </span>
                  </button>
                  {displayedActiveConversation.kind === "group" ? (
                    <button
                      type="button"
                      title="群网盘"
                      onClick={() => openGroupDrivePanel(displayedActiveConversation)}
                    >
                      <ChatIcon name="folder" />
                      <span>群网盘</span>
                    </button>
                  ) : null}
                  <button
                    ref={groupSettingsToggleRef}
                    type="button"
                    className={`icon-only ${
                      (displayedActiveConversation.kind === "group" && groupSettingsOpen) ||
                      (displayedActiveConversation.kind === "direct" && directSettingsOpen)
                        ? "is-active"
                        : ""
                    }`}
                    title={
                      displayedActiveConversation.kind === "group"
                        ? groupSettingsOpen
                          ? "收起群设置"
                          : "打开群设置"
                        : directSettingsOpen
                          ? "收起会话设置"
                          : "打开会话设置"
                    }
                    onClick={() => {
                      if (displayedActiveConversation.kind === "group") {
                        setDirectSettingsOpen(false);
                        setGroupSettingsOpen((open) => !open);
                        return;
                      }
                      setGroupSettingsOpen(false);
                      setDirectSettingsOpen((open) => !open);
                    }}
                  >
                    <ChatIcon name="ellipsis" />
                  </button>
                </div>
              </header>

              <div
                className={`chat-body-row ${
                  displayedActiveConversation.kind === "group"
                    ? `has-group-overview ${
                        groupOverviewHidden ? "is-group-overview-collapsed" : ""
                      }`
                    : ""
                }`}
              >
                <div className="chat-message-stack">
                  <div className="chat-content-row">
                    <div
                      className={`chat-message-scroll ${chatDragActive ? "is-drag-active" : ""}`}
                      ref={messageScrollRef}
                      onDragOver={handleChatDragOver}
                      onDragLeave={handleChatDragLeave}
                      onDrop={(event) => void handleChatDrop(event)}
                    >
                      {chatDragActive ? (
                        <div className="chat-dropzone">
                          <strong>释放文件发送</strong>
                          <span>支持图片、视频、文档和大文件</span>
                        </div>
                      ) : null}
                      {activeMessages.length > 0 &&
                      activeConversation &&
                      !historyExhaustedMap[activeConversation.id] ? (
                        <button
                          type="button"
                          className="chat-load-history"
                          onClick={() => void loadOlderMessages()}
                        >
                          查看更早消息
                        </button>
                      ) : null}
                      {activeMessages.length > 0 ? (
                        activeMessages.map((message, index) => {
                          const previousMessage = activeMessages[index - 1];
                          const showTimeline = shouldShowMessageTimeline(
                            message,
                            previousMessage,
                          );
                          return (
                            <Fragment key={message.id}>
                              {showTimeline ? (
                                <TimelineDivider message={message} />
                              ) : null}
                              <MessageRenderer
                                message={message}
                                conversation={displayedActiveConversation}
                                myProfile={myProfile}
                                profiles={profileMap}
                                multiSelectMode={multiSelectMode}
                                selected={selectedMessageIds.includes(message.id)}
                                highlighted={highlightMessageId === message.id}
                                onOpenFriendProfile={(userId) => {
                                  if (
                                    displayedActiveConversation.kind === "group" &&
                                    userId &&
                                    userId !== currentUserId
                                  ) {
                                    void invoke("open_friend_profile_window", { userId });
                                    return;
                                  }
                                  openFriendProfileWindow(displayedActiveConversation);
                                }}
                                onHoverFriendProfile={(userId, element) =>
                                  scheduleFriendProfileCard(userId, element)
                                }
                                onLeaveFriendProfile={scheduleProfileCardHide}
                                onOpenContactCard={openFriendFromCardMessage}
                                onOpenGroupCard={openGroupFromCardMessage}
                                onPreviewImage={openMediaViewerWindow}
                                onPlayVideo={openMediaViewerWindow}
                                onOpenContextMenu={openMessageMenu}
                                onToggleSelected={() => toggleSelectedMessage(message.id)}
                                onDownloadFile={downloadMessageFile}
                                onLocateQuote={(quote) =>
                                  void locateMessageFromHistory(
                                    quote.conversationId,
                                    quote.id,
                                    quote.conversationSeq ?? null,
                                  )
                                }
                              />
                            </Fragment>
                          );
                        })
                      ) : (
                        <div className="message-system">
                          {displayedActiveConversation.kind === "group"
                            ? "群聊已创建，现在可以开始聊天"
                            : "已添加为好友，现在可以开始聊天"}
                        </div>
                      )}
                    </div>
                  </div>

                  {renderChatComposer()}
                </div>
                {displayedActiveConversation.kind === "group" ? (
                  <GroupOverviewPanel
                    conversation={displayedActiveConversation}
                    group={activeGroup}
                    members={activeGroupMembers}
                    profiles={profileMap}
                    currentUserId={currentUserId}
                    loading={activeGroupLoading}
                    search={groupSearch}
                    hidden={groupOverviewHidden}
                    searchOpen={groupMemberSearchOpen}
                    onSearchChange={setGroupSearch}
                    onToggleHidden={() => setGroupOverviewHidden((hidden) => !hidden)}
                    onToggleSearch={() => setGroupMemberSearchOpen((open) => !open)}
                    onOpenAnnouncement={openGroupAnnouncementWindow}
                    onMemberHover={(profile, element) =>
                      scheduleFriendProfileCard(profile.userId, element, profile)
                    }
                    onMemberLeave={scheduleProfileCardHide}
                    onOpenMemberMenu={(event, userId) => {
                      if (activeGroupId) {
                        openGroupMemberMenu(event, activeGroupId, userId);
                      }
                    }}
                  />
                ) : null}
              </div>

              {displayedActiveConversation.kind === "group" ? (
                <GroupSettingsDrawer
                  drawerRef={groupSettingsDrawerRef}
                  open={groupSettingsOpen}
                  conversation={displayedActiveConversation}
                  group={activeGroup}
                  members={activeGroupMembers}
                  profiles={profileMap}
                  currentUserId={currentUserId}
                  view={groupSettingsView}
                  editing={groupEditing}
                  draft={groupEditDraft}
                  saving={groupSaving}
                  nicknameEditing={groupNicknameEditing}
                  nicknameDraft={groupNicknameDraft}
                  nicknameSaving={groupNicknameSaving}
                  editError={groupEditError}
                  onEdit={openGroupEdit}
                  onOpenAnnouncement={openGroupAnnouncementWindow}
                  onBack={() => setGroupSettingsView("main")}
                  onCancelEdit={cancelGroupEdit}
                  onSaveEdit={() => void saveGroupEdit()}
                  onDraftChange={setGroupEditDraft}
                  onStartNicknameEdit={startEditingGroupNickname}
                  onCancelNicknameEdit={cancelEditingGroupNickname}
                  onNicknameDraftChange={(value) =>
                    setGroupNicknameDraft(value.slice(0, GROUP_NICKNAME_MAX_LENGTH))
                  }
                  onSaveNickname={(value) => void saveGroupNickname(value)}
                  onTogglePinned={toggleActiveConversationPinned}
                  onToggleMuted={toggleActiveConversationMuted}
                  onClearHistory={requestClearConversationHistory}
                  onSelectAvatar={selectGroupAvatar}
                  onShareGroup={() =>
                    openGroupShareDialog(
                      groupSnapshotFromGroup(activeGroup, displayedActiveConversation),
                    )
                  }
                  onInvite={openInviteGroupDialog}
                  onRemove={openRemoveGroupDialog}
                  onMemberMenu={(event, userId) => {
                    if (activeGroupId) {
                      openGroupMemberMenu(event, activeGroupId, userId);
                    }
                  }}
                  onLeave={() => requestGroupMemberAction("leave-group")}
                  onDissolve={() => requestGroupMemberAction("dissolve-group")}
                />
              ) : null}
              {displayedActiveConversation.kind === "direct" ? (
                <DirectSettingsDrawer
                  drawerRef={directSettingsDrawerRef}
                  open={directSettingsOpen}
                  conversation={displayedActiveConversation}
                  onTogglePinned={toggleActiveConversationPinned}
                  onToggleMuted={toggleActiveConversationMuted}
                  onClearHistory={requestClearConversationHistory}
                  onDeleteFriend={requestDeleteDirectFriend}
                />
              ) : null}

            </section>
          ) : (
            <section className="chat-main-panel is-empty" ref={chatMainPanelRef}>
              <NoConversationSelected
                dataSource={dataSource}
                accountState={accountState}
                onAddFriend={openProfileSearchWindow}
              />
            </section>
          )
        ) : activeSection === "contacts" ? (
          <section className="chat-main-panel is-empty" ref={chatMainPanelRef}>
            <ContactDetailPanel
              view={contactDetailView}
              profile={activeContactProfile}
              group={activeContactGroup}
              groupConversation={activeContactGroupConversation}
              groupMembers={activeContactGroupMembers}
              groupLoading={activeContactGroupLoading}
              groupMembership={activeContactGroupMembership}
              profiles={profileMap}
              requests={friendRequests}
              groupRequests={groupRequests}
              currentUserId={currentUserId}
              loading={contactsLoading}
              error={contactsError}
              onAddFriend={openProfileSearchWindow}
              onSendMessage={(profile) => void openDirectConversation(profile.userId)}
              onOpenGroupConversation={(conversation) => {
                selectConversation(conversation.id);
                setActiveSection("messages");
              }}
              onApplyGroup={(groupId) => {
                const snapshot = activeContactGroupConversation
                  ? groupSnapshotFromConversation(
                      activeContactGroupConversation,
                      activeContactGroup,
                    )
                  : activeContactGroup
                    ? {
                        id: groupId,
                        conversationId: activeContactGroup.conversationId,
                        name: activeContactGroup.name,
                        avatarUrl: activeContactGroup.avatarUrl ?? null,
                        avatarObjectKey: activeContactGroup.avatarObjectKey ?? null,
                        description: activeContactGroup.description ?? null,
                        announcement: activeContactGroup.announcement ?? null,
                        memberCount: activeContactGroup.memberCount ?? null,
                      }
                    : {
                        id: groupId,
                        name: "群聊",
                        conversationId: null,
                        avatarUrl: null,
                        avatarObjectKey: null,
                        description: null,
                        announcement: null,
                        memberCount: null,
                      };
                void requestJoinGroupFromProfile(snapshot);
              }}
              onShareGroup={(group, conversation) =>
                openGroupShareDialog(groupSnapshotFromGroup(group, conversation))
              }
              onAccept={(request) =>
                void updateFriendRequestStatus(request, "accept")
              }
              onReject={(request) =>
                void updateFriendRequestStatus(request, "reject")
              }
              onAcceptGroupRequest={(request) =>
                void updateGroupRequestStatus(request, "accept")
              }
              onRejectGroupRequest={(request) =>
                void updateGroupRequestStatus(request, "reject")
              }
            />
          </section>
        ) : null}
      </section>

      {profileCard ? (
        <ProfileHoverCard
          state={profileCard}
          currentUserId={currentUserId}
          friends={displayedFriends}
          onMouseEnter={keepProfileCardOpen}
          onMouseLeave={scheduleProfileCardHide}
          onClose={closeProfileCard}
          onFriendMessage={sendMessageToProfile}
          onFriendAdd={openFriendRequestFromProfile}
          onFriendShare={(profile) => openShareCardDialog(shareSubjectFromProfile(profile))}
          onGroupMessage={sendMessageToGroup}
          onGroupOpenMembers={openGroupMemberDetails}
          onGroupApply={(group) => void requestJoinGroupFromProfile(group)}
          onGroupShare={openGroupShareDialog}
        />
      ) : null}

      {groupShareDialog ? (
        <GroupShareModal
          state={groupShareDialog}
          onClose={() => {
            if (!groupShareDialog.saving) {
              setGroupShareDialog(null);
            }
          }}
          onRetry={() => openGroupShareDialog(groupShareDialog.group)}
          onForward={forwardGroupShareCard}
          onSave={() => void saveGroupSharePoster()}
        />
      ) : null}

      {shareCard ? (
        <CardShareDialog
          state={shareCard}
          recipients={shareRecipients}
          onClose={() => {
            if (!shareCard.sending) {
              setShareCard(null);
            }
          }}
          onSearchChange={(value) =>
            updateShareCard((current) => ({ ...current, search: value }))
          }
          onNoteChange={(value) =>
            updateShareCard((current) => ({ ...current, note: value }))
          }
          onToggleRecipient={toggleShareRecipient}
          onRemoveRecipient={toggleShareRecipient}
          onSubmit={() => void sendShareCard()}
        />
      ) : null}

      {conversationMenu ? (
        <div
          className="conversation-context-menu"
          style={{ left: conversationMenu.x, top: conversationMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => togglePinnedConversation(conversationMenu.conversationId)}
          >
            {conversations.find(
              (conversation) =>
                conversation.id === conversationMenu.conversationId,
            )?.pinned
              ? "取消置顶"
              : "置顶"}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => removeConversation(conversationMenu.conversationId)}
          >
            从消息列表中删除
          </button>
        </div>
      ) : null}

      {messageMenu ? (
        <MessageContextMenuView
          menu={messageMenu}
          message={messages.find((message) => message.id === messageMenu.messageId)}
          conversation={displayedActiveConversation}
          group={activeGroup}
          onAction={handleMessageMenuAction}
        />
      ) : null}

      {groupMemberMenu ? (
        <GroupMemberContextMenuView
          menu={groupMemberMenu}
          member={activeGroupMembers.find(
            (member) => member.userId === groupMemberMenu.memberUserId,
          )}
          currentRole={activeGroup?.currentUserRole ?? "member"}
          currentUserId={currentUserId}
          onOpenProfile={(userId) => {
            setGroupMemberMenu(null);
            openGroupMemberProfile(userId);
          }}
          onSendMessage={(userId) => {
            setGroupMemberMenu(null);
            void openDirectConversation(userId);
          }}
          onAction={(action, member) => requestGroupMemberAction(action, member)}
        />
      ) : null}

      {groupConfirm ? (
        <GroupConfirmDialog
          state={groupConfirm}
          busy={groupActionBusy}
          onCancel={() => {
            if (!groupActionBusy) {
              setGroupConfirm(null);
            }
          }}
          onConfirm={() => void runGroupConfirmAction()}
        />
      ) : null}

      {forwardPicker ? (
        <ForwardPickerDialog
          conversations={sortedConversations.map((conversation) =>
            withProfile(conversation, profileMap),
          )}
          sourceCount={forwardPicker.messageIds.length}
          onClose={() => setForwardPicker(null)}
          onSelect={(conversation) => void forwardMessagesToConversation(conversation)}
        />
      ) : null}

      {driveForwardPicker ? (
        <DriveForwardPickerDialog
          conversations={sortedConversations.map((conversation) =>
            withProfile(conversation, profileMap),
          )}
          nodeName={driveForwardPicker.nodeName}
          onClose={() => setDriveForwardPicker(null)}
          onSelect={(conversation) =>
            void forwardDriveNodeToConversation(driveForwardPicker.nodeId, conversation)
          }
        />
      ) : null}

      {transferDrawerOpen ? (
        <TransferDrawer
          tasks={activeTransferTasks}
          activeTab={transferTab}
          onChangeTab={setTransferTab}
          onClose={() => setTransferDrawerOpen(false)}
          onPause={(taskId) => void controlChatUploadTask(taskId, "pause")}
          onResume={(taskId) => void controlChatUploadTask(taskId, "resume")}
          onCancel={(taskId) => void controlChatUploadTask(taskId, "cancel")}
          onRetry={(task) => void retryTransferTask(task)}
        />
      ) : null}

      {driveSaveNotice ? (
        <div className="drive-save-toast">{driveSaveNotice.label}</div>
      ) : null}

      {createGroupOpen ? (
        <CreateGroupDialog
          friends={displayedFriends}
          groupType={createGroupType}
          loading={contactsLoading}
          error={createGroupError || contactsError}
          search={createGroupSearch}
          groupName={createGroupName}
          selectedIds={selectedGroupMemberIds}
          submitting={creatingGroup}
          onSearchChange={setCreateGroupSearch}
          onGroupNameChange={setCreateGroupName}
          onToggleFriend={toggleGroupMemberSelection}
          onAddFriend={openProfileSearchWindow}
          onClose={closeCreateGroupDialog}
          onSubmit={() => void submitCreateGroup()}
        />
      ) : null}

      {inviteGroupOpen ? (
        <InviteGroupDialog
          friends={displayedFriends.filter(
            (friend) =>
              !activeGroupMembers.some((member) => member.userId === friend.userId),
          )}
          loading={contactsLoading}
          error={inviteGroupError || contactsError}
          notice={inviteGroupNotice}
          approvalRequired={
            activeGroup?.currentUserRole !== "owner" &&
            activeGroup?.currentUserRole !== "admin"
          }
          search={inviteGroupSearch}
          selectedIds={selectedInviteMemberIds}
          submitting={invitingGroup}
          memberCount={activeGroupMembers.length || activeGroup?.memberCount || 0}
          memberLimit={activeGroup?.memberLimit ?? 500}
          onSearchChange={setInviteGroupSearch}
          onToggleFriend={toggleInviteMemberSelection}
          onAddFriend={openProfileSearchWindow}
          onClose={closeInviteGroupDialog}
          onSubmit={() => void submitInviteGroupMembers()}
        />
      ) : null}

      {removeGroupOpen ? (
        <RemoveGroupMembersDialog
          members={activeGroupMembers}
          profiles={profileMap}
          currentUserId={currentUserId}
          currentRole={activeGroup?.currentUserRole ?? "member"}
          search={removeGroupSearch}
          selectedIds={selectedRemoveMemberIds}
          submitting={removingGroupMembers || groupActionBusy}
          error={removeGroupError}
          onSearchChange={setRemoveGroupSearch}
          onToggleMember={toggleRemoveMemberSelection}
          onClose={closeRemoveGroupDialog}
          onSubmit={() => requestGroupMemberAction("remove-members")}
        />
      ) : null}

      {rtcTestOpen ? (
        <RtcTestPanel
          defaultChannelId={rtcDefaultChannelId}
          currentUserId={Number.isInteger(currentUserId) ? currentUserId : null}
          displayName={myProfile?.nickname || `用户${currentUserId || ""}`}
          onClose={() => setRtcTestOpen(false)}
        />
      ) : null}
    </main>
  );
}

function ProfileHoverCard({
  state,
  currentUserId,
  friends,
  onMouseEnter,
  onMouseLeave,
  onClose,
  onFriendMessage,
  onFriendAdd,
  onFriendShare,
  onGroupMessage,
  onGroupOpenMembers,
  onGroupApply,
  onGroupShare,
}: {
  state: NonNullable<ProfileCardState>;
  currentUserId: number;
  friends: UserProfile[];
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClose: () => void;
  onFriendMessage: (profile: UserProfile) => void;
  onFriendAdd: (profile: UserProfile) => void;
  onFriendShare: (profile: UserProfile) => void;
  onGroupMessage: (group: GroupProfileSnapshot) => void;
  onGroupOpenMembers: (group: GroupProfileSnapshot) => void;
  onGroupApply: (group: GroupProfileSnapshot) => void;
  onGroupShare: (group: GroupProfileSnapshot) => void;
}) {
  const style = profileCardPositionStyle(state);
  if (state.kind === "friend") {
    const profile = state.profile;
    const isClassAccount = profile.accountType === "class";
    const accountLine = isClassAccount && profile.classNo ? profile.classNo : "";
    const relation =
      profile.userId === currentUserId
        ? "self"
        : friends.some((friend) => friend.userId === profile.userId) ||
            profile.friendStatus === "friend"
          ? "friend"
          : "none";
    return (
      <section
        className={`profile-hover-card ${state.mode === "pinned" ? "is-pinned" : ""}`}
        style={style}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={(event) => event.stopPropagation()}
      >
        {state.mode === "pinned" ? (
          <button type="button" className="profile-hover-close" onClick={onClose}>
            ×
          </button>
        ) : null}
        <div className="profile-hover-hero">
          <ProfileAvatarLite profile={profile} />
          <div>
            <h3>{profile.nickname || `用户${profile.userId}`}</h3>
            {accountLine ? <p>{accountLine}</p> : null}
          </div>
        </div>
        <p className="profile-hover-bio">{profile.bio || "暂无简介"}</p>
        {relation === "self" ? null : relation === "friend" ? (
          <div className="profile-hover-actions">
            <button type="button" onClick={() => onFriendShare(profile)}>
              分享
            </button>
            <button
              type="button"
              className="profile-primary-button"
              onClick={() => onFriendMessage(profile)}
            >
              发消息
            </button>
          </div>
        ) : (
          <div className="profile-hover-actions">
            <button
              type="button"
              className="profile-primary-button"
              onClick={() => onFriendAdd(profile)}
            >
              加好友
            </button>
          </div>
        )}
      </section>
    );
  }

  const group = state.group;
  const groupJoined = state.membership === "joined";
  const groupPending = state.membership === "pending";
  const groupDescription = group.description?.trim() || "暂无群介绍";
  const groupAnnouncement = group.announcement?.trim() || "暂无群公告";
  return (
    <section
      className={`profile-hover-card group-profile-hover-card ${
        state.mode === "pinned" ? "is-pinned" : ""
      }`}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(event) => event.stopPropagation()}
    >
      {state.mode === "pinned" ? (
        <button type="button" className="profile-hover-close" onClick={onClose}>
          ×
        </button>
      ) : null}
      <div className="profile-hover-hero">
        <Avatar label={group.name.slice(0, 1)} imageUrl={group.avatarUrl} tone="group" />
        <div>
          <h3>{group.name}</h3>
          <p>{formatGroupNo(group)}</p>
        </div>
        {groupJoined ? (
          <button
            type="button"
            className="profile-hover-share"
            title="分享群"
            onClick={() => onGroupShare(group)}
          >
            <ChatIcon name="share" />
          </button>
        ) : null}
      </div>
      <div className="profile-hover-fields">
        <button type="button" onClick={() => onGroupOpenMembers(group)}>
          <span>群简介</span>
          <strong title={groupDescription}>{groupDescription}</strong>
          <i>›</i>
        </button>
        <button type="button" onClick={() => onGroupOpenMembers(group)}>
          <span>群公告</span>
          <strong title={groupAnnouncement}>{groupAnnouncement}</strong>
          <i>›</i>
        </button>
      </div>
      {groupJoined ? (
        <div className="profile-hover-actions group-profile-actions">
          <button type="button" onClick={() => onGroupShare(group)}>
            分享
          </button>
          <button
            type="button"
            className="profile-primary-button"
            onClick={() => onGroupMessage(group)}
          >
            发消息
          </button>
        </div>
      ) : groupPending ? (
        <div className="profile-hover-actions is-single">
          <button type="button" disabled>
            等待审核
          </button>
        </div>
      ) : (
        <div className="profile-hover-actions is-single">
          <button
            type="button"
            className="profile-primary-button"
            onClick={() => onGroupApply(group)}
          >
            申请加群
          </button>
        </div>
      )}
    </section>
  );
}

function CardShareDialog({
  state,
  recipients,
  onClose,
  onSearchChange,
  onNoteChange,
  onToggleRecipient,
  onRemoveRecipient,
  onSubmit,
}: {
  state: NonNullable<ShareCardDialogState>;
  recipients: ShareCardRecipient[];
  onClose: () => void;
  onSearchChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onToggleRecipient: (key: string) => void;
  onRemoveRecipient: (key: string) => void;
  onSubmit: () => void;
}) {
  const query = state.search.trim().toLowerCase();
  const filteredRecipients = query
    ? recipients.filter((recipient) =>
        `${recipient.title} ${recipient.subtitle}`.toLowerCase().includes(query),
      )
    : recipients;
  const selectedRecipients = state.selectedKeys
    .map((key) => recipients.find((recipient) => recipient.key === key))
    .filter(Boolean) as ShareCardRecipient[];
  const subject = state.subject;
  const subjectTone = subject.kind === "group" ? "group" : "direct";
  const subjectLabel = subject.title.trim().slice(0, 1) || (subject.kind === "group" ? "群" : "友");

  return (
    <div className="chat-modal-backdrop card-share-backdrop" onClick={onClose}>
      <section className="card-share-dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <span>
            <h2>分享名片</h2>
            <p>{subject.kind === "contact" ? "好友名片" : "群名片"}：{subject.title}</p>
          </span>
          <button type="button" className="card-share-close" disabled={state.sending} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="card-share-body">
          <section className="card-share-left">
            <label className="card-share-search">
              <ChatIcon name="search" />
              <input
                value={state.search}
                placeholder="搜索好友、群聊"
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </label>
            <div className="card-share-list">
              {filteredRecipients.length > 0 ? (
                filteredRecipients.map((recipient) => {
                  const selected = state.selectedKeys.includes(recipient.key);
                  return (
                    <button
                      key={recipient.key}
                      type="button"
                      className={selected ? "is-selected" : ""}
                      aria-pressed={selected}
                      onClick={() => onToggleRecipient(recipient.key)}
                    >
                      <span className="card-share-check" aria-hidden="true">
                        {selected ? "✓" : ""}
                      </span>
                      <Avatar
                        label={recipient.avatarLabel}
                        imageUrl={recipient.avatarUrl}
                        tone={recipient.kind === "group" ? "group" : "direct"}
                      />
                      <span className="card-share-recipient-copy">
                        <strong>{recipient.title}</strong>
                        <em>{recipient.subtitle}</em>
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="forward-picker-empty">暂无可分享会话</p>
              )}
            </div>
          </section>
          <section className="card-share-right">
            <h3>
              分别发送给：
              <span>已选 {selectedRecipients.length} 个</span>
            </h3>
            <div className="card-share-selected-list" aria-label="已选接收方">
              {selectedRecipients.length > 0 ? (
                selectedRecipients.map((recipient) => (
                  <div className="card-share-selected-row" key={recipient.key}>
                    <Avatar
                      label={recipient.avatarLabel}
                      imageUrl={recipient.avatarUrl}
                      tone={recipient.kind === "group" ? "group" : "direct"}
                    />
                    <strong>{recipient.title}</strong>
                    <button
                      type="button"
                      aria-label={`移除 ${recipient.title}`}
                      onClick={() => onRemoveRecipient(recipient.key)}
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <p>请选择接收方</p>
              )}
            </div>
            <section className="card-share-preview" aria-label="转发内容预览">
              <span className="card-share-preview-label">转发内容</span>
              <div className="card-share-preview-card">
                <Avatar
                  label={subjectLabel}
                  imageUrl={subject.avatarUrl}
                  tone={subjectTone}
                />
                <span className="card-share-preview-main">
                  <strong>{subject.title}</strong>
                </span>
                {subject.kind === "group" ? (
                  <span className="card-share-qr-mini" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                ) : (
                  <span className="card-share-namecard-badge">名片</span>
                )}
              </div>
            </section>
            <label className="card-share-note">
              <span>留言</span>
              <textarea
                value={state.note}
                maxLength={200}
                placeholder="留言"
                onChange={(event) => onNoteChange(event.target.value)}
              />
            </label>
          </section>
        </div>
        {state.error ? <p className="card-share-error">{state.error}</p> : null}
        <footer>
          <button type="button" disabled={state.sending} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="profile-primary-button"
            disabled={state.sending || state.selectedKeys.length === 0}
            onClick={onSubmit}
          >
            {state.sending ? "发送中..." : "确定"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function profileCardPositionStyle(state: NonNullable<ProfileCardState>): CSSProperties {
  if (!state.anchor || state.mode === "pinned") {
    return {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
    };
  }
  const cardWidth = 292;
  const cardHeight = 268;
  const gap = 10;
  const viewportWidth =
    typeof window === "undefined" ? 1200 : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined" ? 800 : window.innerHeight;
  const canOpenRight = state.anchor.right + gap + cardWidth <= viewportWidth - 12;
  const left = canOpenRight
    ? state.anchor.right + gap
    : Math.max(12, state.anchor.left - cardWidth - gap);
  const top = clampNumber(
    state.anchor.top - 18,
    12,
    Math.max(12, viewportHeight - cardHeight - 12),
  );
  return { left, top };
}

function ChatDataSourceBanner({
  dataSource,
  accountState,
}: {
  dataSource: ChatDataSourceState;
  accountState: LocalAccountState | null;
}) {
  if (dataSource.loading) {
    return <div className="chat-source-banner">正在连接云端会话...</div>;
  }

  if (dataSource.live) {
    return (
      <div className="chat-source-banner is-live">
        云端会话已连接
      </div>
    );
  }

  return (
    <div className="chat-source-banner is-mock">
      {accountState?.loggedIn
        ? "未连接云端，当前显示预览数据"
        : "未登录，当前显示预览数据"}
    </div>
  );
}

function ComposerQuotePreview({
  quoteMeta,
  onClear,
}: {
  quoteMeta: QuoteMeta;
  onClear: () => void;
}) {
  const quote = quoteFromMetaForRender(quoteMeta);
  return (
    <div className="composer-quote-card">
      <QuotePreviewThumb quote={quote} />
      <div className="composer-quote-main">
        <strong>{quote.senderLabel}:</strong>
        <span>{quote.preview}</span>
      </div>
      <button
        type="button"
        className="composer-quote-close"
        aria-label="取消引用"
        onClick={onClear}
      >
        ×
      </button>
    </div>
  );
}

function MessageQuoteBlock({
  quote,
  onLocate,
}: {
  quote: NonNullable<ReturnType<typeof quoteFromMessage>>;
  onLocate: () => void;
}) {
  return (
    <button
      type="button"
      className="message-quote"
      onClick={(event) => {
        event.stopPropagation();
        onLocate();
      }}
    >
      <QuotePreviewThumb quote={quote} />
      <span className="message-quote-main">
        <strong>{quote.senderLabel}:</strong>
        <span>{quote.preview}</span>
      </span>
    </button>
  );
}

function QuotePreviewThumb({
  quote,
}: {
  quote: Pick<
    NonNullable<ReturnType<typeof quoteFromMessage>>,
    "messageType" | "thumbnailUrl" | "fileObjectId" | "fileName"
  >;
}) {
  const fileObjectId = quote.fileObjectId || "";
  const [cachedUrl, setCachedUrl] = useState("");
  const [directUrlFailed, setDirectUrlFailed] = useState(false);

  useEffect(() => {
    setDirectUrlFailed(false);
  }, [fileObjectId, quote.thumbnailUrl]);

  useEffect(() => {
    if (!fileObjectId) {
      setCachedUrl("");
      return;
    }
    let disposed = false;
    void cacheChatFile(
      fileObjectId,
      quote.fileName || (quote.messageType === "sticker" ? "表情" : "图片"),
    )
      .then((nextUrl) => {
        if (!disposed && nextUrl) {
          setCachedUrl(nextUrl);
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [fileObjectId, quote.fileName, quote.messageType]);

  const imageUrl = cachedUrl || (!directUrlFailed ? quote.thumbnailUrl || "" : "");
  if (imageUrl) {
    return (
      <span className="quote-preview-thumb has-image">
        <img src={imageUrl} alt="" onError={() => setDirectUrlFailed(true)} />
      </span>
    );
  }
  return (
    <span className="quote-preview-thumb" aria-hidden="true">
      {quoteIconLabel(String(quote.messageType))}
    </span>
  );
}

function quoteFromMetaForRender(
  quoteMeta: QuoteMeta,
): NonNullable<ReturnType<typeof quoteFromMessage>> {
  return {
    id: quoteMeta.quotedMessageId,
    conversationId: quoteMeta.quotedConversationId,
    conversationSeq: quoteMeta.quotedConversationSeq ?? null,
    senderId: quoteMeta.quotedSenderId ?? null,
    senderLabel: quoteMeta.quotedSenderName || "对方",
    preview: quoteMeta.isRevoked
      ? "原消息已撤回"
      : quoteMeta.isDeleted
        ? "原消息不可查看"
        : quoteMeta.previewText || "聊天记录",
    messageType: quoteMeta.quotedMessageType || "text",
    thumbnailUrl: quoteMeta.thumbnailUrl ?? null,
    fileObjectId: quoteMeta.fileObjectId ?? null,
    fileName: quoteMeta.fileName ?? null,
    fileSize: quoteMeta.fileSize ?? null,
    duration: quoteMeta.duration ?? null,
    isDeleted: quoteMeta.isDeleted,
    isRevoked: quoteMeta.isRevoked,
    quotedCreatedAt: quoteMeta.quotedCreatedAt ?? null,
  };
}

function quoteIconLabel(messageType: string): string {
  if (messageType === "image") {
    return "图";
  }
  if (messageType === "sticker") {
    return "表";
  }
  if (messageType === "file") {
    return "文";
  }
  if (messageType === "contact_card") {
    return "名";
  }
  if (messageType === "group_card" || messageType === "group_share_card") {
    return "群";
  }
  if (messageType === "call_event") {
    return "话";
  }
  return "引";
}

function MessageContextMenuView({
  menu,
  message,
  conversation,
  group,
  onAction,
}: {
  menu: NonNullable<MessageContextMenu>;
  message?: ChatMessage;
  conversation: ChatConversation | null;
  group: ChatGroup | null;
  onAction: (action: MessageMenuAction, message: ChatMessage) => void;
}) {
  if (!message) {
    return null;
  }
  const canDownload =
    !isMessageFileDefinitelyUnavailable(message) &&
    (message.kind === "image" ||
      message.kind === "video" ||
      message.kind === "file" ||
      message.kind === "sticker");
  const isFileLike = Boolean(fileTypeFromMessage(message));
  const canUseCloudFile = !isFileLike || chatFileCloudAvailable(message);
  const canSaveGroupDrive =
    isFileLike &&
    canUseCloudFile &&
    conversation?.kind === "group" &&
    canManageGroupDrive(group);
  const canRevoke =
    message.direction === "outgoing" &&
    message.status === "sent" &&
    !message.id.startsWith("msg-local-");
  return (
    <div
      className="message-context-menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      {isVideoMessage(message) ? (
        <button type="button" onClick={() => onAction("play", message)}>
          播放
        </button>
      ) : isFileLike && canUseCloudFile ? (
        <button type="button" onClick={() => onAction("open", message)}>
          打开
        </button>
      ) : null}
      {canDownload ? (
        <button type="button" onClick={() => onAction("download", message)}>
          下载
        </button>
      ) : null}
      {canUseCloudFile ? (
        <button type="button" onClick={() => onAction("forward", message)}>
          转发
        </button>
      ) : null}
      {isFileLike && canUseCloudFile ? (
        <button type="button" onClick={() => onAction("save-personal-drive", message)}>
          存入我的网盘
        </button>
      ) : null}
      {isFileLike && !canUseCloudFile ? (
        <button type="button" disabled title={chatFileAccessReason(message)}>
          文件已过期
        </button>
      ) : null}
      {canSaveGroupDrive ? (
        <button type="button" onClick={() => onAction("save-group-drive", message)}>
          存入群网盘
        </button>
      ) : null}
      {isFileLike ? (
        <button type="button" onClick={() => onAction("copy-file-name", message)}>
          复制文件名
        </button>
      ) : null}
      <button type="button" onClick={() => onAction("multi-select", message)}>
        多选
      </button>
      <button type="button" onClick={() => onAction("quote", message)}>
        引用
      </button>
      {canRevoke ? (
        <button type="button" onClick={() => onAction("revoke", message)}>
          撤回
        </button>
      ) : null}
      <button
        type="button"
        className="danger"
        onClick={() => onAction("delete", message)}
      >
        删除
      </button>
    </div>
  );
}

function GroupMemberContextMenuView({
  menu,
  member,
  currentRole,
  currentUserId,
  onOpenProfile,
  onSendMessage,
  onAction,
}: {
  menu: NonNullable<GroupMemberContextMenu>;
  member?: ChatGroupMember;
  currentRole: string;
  currentUserId: number;
  onOpenProfile: (userId: number) => void;
  onSendMessage: (userId: number) => void;
  onAction: (action: GroupConfirmAction, member: ChatGroupMember) => void;
}) {
  if (!member) {
    return null;
  }
  const isSelf = member.userId === currentUserId;
  const canOwnerManage = currentRole === "owner" && !isSelf && member.role !== "owner";
  const canAdminRemove = currentRole === "admin" && member.role === "member" && !isSelf;
  return (
    <div
      className="group-member-context-menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" onClick={() => onOpenProfile(member.userId)}>
        查看资料
      </button>
      {!isSelf ? (
        <button type="button" onClick={() => onSendMessage(member.userId)}>
          发送消息
        </button>
      ) : null}
      {canOwnerManage && member.role === "member" ? (
        <button type="button" onClick={() => onAction("set-admin", member)}>
          设为管理员
        </button>
      ) : null}
      {canOwnerManage && member.role === "admin" ? (
        <button type="button" onClick={() => onAction("unset-admin", member)}>
          取消管理员
        </button>
      ) : null}
      {canOwnerManage ? (
        <button type="button" onClick={() => onAction("transfer-owner", member)}>
          转让群主
        </button>
      ) : null}
      {canOwnerManage || canAdminRemove ? (
        <button
          type="button"
          className="danger"
          onClick={() => onAction("remove-member", member)}
        >
          移出群聊
        </button>
      ) : null}
    </div>
  );
}

function GroupShareModal({
  state,
  onClose,
  onRetry,
  onForward,
  onSave,
}: {
  state: NonNullable<GroupShareDialogState>;
  onClose: () => void;
  onRetry: () => void;
  onForward: () => void;
  onSave: () => void;
}) {
  const groupName = state.invite?.group.name || state.group.name || "群聊";
  const groupNo = formatGroupNo(state.invite?.group ?? state.group);
  const avatarUrl = state.invite?.group.avatarUrl || state.group.avatarUrl || null;
  const ready = Boolean(state.invite && state.qrDataUrl && !state.loading);
  return (
    <div className="chat-modal-backdrop group-share-backdrop" onClick={onClose}>
      <section
        className="group-share-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="group-share-close"
          onClick={onClose}
          disabled={state.saving}
        >
          ×
        </button>
        <header className="group-share-header">
          <Avatar label={groupName.slice(0, 1)} imageUrl={avatarUrl} tone="group" />
          <div>
            <h2>{groupName}</h2>
            <p>群号：{groupNo}</p>
          </div>
        </header>
        <div className="group-share-qr-shell">
          {state.loading ? (
            <div className="group-share-qr-skeleton" aria-label="二维码生成中" />
          ) : state.error ? (
            <div className="group-share-error">
              <strong>二维码生成失败</strong>
              <p>{state.error}</p>
              <button type="button" onClick={onRetry}>
                重试
              </button>
            </div>
          ) : state.qrDataUrl ? (
            <div className="group-share-qr-card">
              <img src={state.qrDataUrl} alt="群邀请二维码" />
              <span className="group-share-qr-logo">
                {avatarUrl ? <img src={avatarUrl} alt="" /> : groupName.slice(0, 1)}
              </span>
            </div>
          ) : null}
        </div>
        <p className="group-share-tip">扫一扫二维码，加入群聊</p>
        <footer>
          <button
            type="button"
            className="group-share-primary"
            disabled={!ready || state.saving}
            onClick={onForward}
          >
            转发
          </button>
          <button
            type="button"
            className="group-share-secondary"
            disabled={!ready || state.saving}
            onClick={onSave}
          >
            {state.saving ? "保存中..." : "保存图片"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function GroupConfirmDialog({
  state,
  busy,
  onCancel,
  onConfirm,
}: {
  state: NonNullable<GroupConfirmState>;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="group-confirm-backdrop" onClick={onCancel}>
      <section className="group-confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <h2>{state.title}</h2>
        <p>{state.description}</p>
        <footer>
          <button type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={state.danger ? "danger" : "profile-primary-button"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "处理中..." : state.confirmText}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ForwardPickerDialog({
  conversations,
  sourceCount,
  onClose,
  onSelect,
}: {
  conversations: ChatConversation[];
  sourceCount: number;
  onClose: () => void;
  onSelect: (conversation: ChatConversation) => void;
}) {
  return (
    <div className="chat-modal-backdrop" onClick={onClose}>
      <section className="forward-picker" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>转发给</h2>
          <p>{sourceCount} 条消息</p>
        </header>
        <div className="forward-picker-list">
          {conversations.length > 0 ? (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => onSelect(conversation)}
              >
                <Avatar
                  label={conversation.participant.avatar}
                  imageUrl={conversation.participant.avatarUrl}
                  tone={conversation.kind}
                />
                <span>
                  <strong>{conversation.title}</strong>
                  <em>{conversation.subtitle}</em>
                </span>
              </button>
            ))
          ) : (
            <p className="forward-picker-empty">暂无可转发会话</p>
          )}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            取消
          </button>
        </footer>
      </section>
    </div>
  );
}

function DriveForwardPickerDialog({
  conversations,
  nodeName,
  onClose,
  onSelect,
}: {
  conversations: ChatConversation[];
  nodeName: string;
  onClose: () => void;
  onSelect: (conversation: ChatConversation) => void;
}) {
  return (
    <div className="chat-modal-backdrop" onClick={onClose}>
      <section className="forward-picker" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>转发文件</h2>
          <p>{nodeName}</p>
        </header>
        <div className="forward-picker-list">
          {conversations.length > 0 ? (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => onSelect(conversation)}
              >
                <Avatar
                  label={conversation.participant.avatar}
                  imageUrl={conversation.participant.avatarUrl}
                  tone={conversation.kind}
                />
                <span>
                  <strong>{conversation.title}</strong>
                  <em>{conversation.subtitle}</em>
                </span>
              </button>
            ))
          ) : (
            <p className="forward-picker-empty">暂无可转发会话</p>
          )}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            取消
          </button>
        </footer>
      </section>
    </div>
  );
}

function TransferDrawer({
  tasks,
  activeTab,
  onChangeTab,
  onClose,
  onPause,
  onResume,
  onCancel,
  onRetry,
}: {
  tasks: TransferTask[];
  activeTab: "uploading" | "downloading" | "completed";
  onChangeTab: (tab: "uploading" | "downloading" | "completed") => void;
  onClose: () => void;
  onPause: (taskId: string) => void;
  onResume: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onRetry: (task: TransferTask) => void;
}) {
  const visibleTasks = tasks.filter((task) => {
    if (activeTab === "uploading") {
      return task.direction === "upload" && !["completed", "instant_completed", "canceled"].includes(task.status);
    }
    if (activeTab === "downloading") {
      return task.direction === "download" && !["completed", "canceled"].includes(task.status);
    }
    return ["completed", "instant_completed", "canceled"].includes(task.status);
  });
  return (
    <aside className="transfer-drawer" onClick={(event) => event.stopPropagation()}>
      <header>
        <div>
          <h2>传输</h2>
          <p>当前会话上传、下载和完成记录</p>
        </div>
        <button type="button" onClick={onClose}>×</button>
      </header>
      <nav>
        {[
          ["uploading", "上传中"],
          ["downloading", "下载中"],
          ["completed", "已完成"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={activeTab === key ? "is-active" : ""}
            onClick={() => onChangeTab(key as "uploading" | "downloading" | "completed")}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="transfer-list">
        {visibleTasks.length > 0 ? (
          visibleTasks.map((task) => {
            const progress = task.fileSize
              ? Math.round(((task.uploadedBytes || task.downloadedBytes || 0) / task.fileSize) * 100)
              : 0;
            return (
              <article key={task.id} className={`transfer-task is-${task.status}`}>
                <div>
                  <strong>{task.fileName}</strong>
                  <span>
                    {formatBytes(task.fileSize)}
                    {" · "}
                    {transferStatusLabel(task.status)}
                    {task.speedBytes ? ` · ${formatBytes(task.speedBytes)}/s` : ""}
                    {task.remainingSeconds ? ` · 剩余 ${formatDuration(task.remainingSeconds)}` : ""}
                  </span>
                </div>
                <i><b style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></i>
                {task.errorMessage ? <em>{task.errorMessage}</em> : null}
                <footer>
                  {task.status === "uploading" || task.status === "hashing" ? (
                    <button type="button" onClick={() => onPause(task.id)}>暂停</button>
                  ) : null}
                  {task.status === "paused" ? (
                    <button type="button" onClick={() => onResume(task.id)}>继续</button>
                  ) : null}
                  {task.status === "failed" ? (
                    <button type="button" onClick={() => onRetry(task)}>重试</button>
                  ) : null}
                  {!["completed", "instant_completed", "canceled"].includes(task.status) ? (
                    <button type="button" onClick={() => onCancel(task.id)}>取消</button>
                  ) : null}
                </footer>
              </article>
            );
          })
        ) : (
          <p className="transfer-empty">当前会话暂无传输任务</p>
        )}
      </div>
    </aside>
  );
}

function DrivePanelView({
  state,
  conversations: _conversations,
  canManage,
  onClose,
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
  conversations: ChatConversation[];
  canManage: boolean;
  onClose: () => void;
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
  const filters: Array<[DriveFilter, string]> = [
    ["all", "全部"],
    ["image", "图片"],
    ["video", "视频"],
    ["document", "文档"],
    ["archive", "压缩包"],
    ["other", "其他"],
  ];
  return (
    <section className={`drive-panel-view is-${state.mode}`}>
      <header className="drive-panel-header">
        <div>
          <h2>{state.title}</h2>
          <p>{state.mode === "group" ? "群内长期资料沉淀，不自动收纳聊天文件" : "个人长期文件资产"}</p>
        </div>
        <div className="drive-panel-actions">
          <button type="button" onClick={onRefresh}>刷新</button>
          {canManage ? (
            <>
              <button type="button" onClick={onCreateFolder}>新建文件夹</button>
              <button type="button" className="profile-primary-button" onClick={onUpload}>
                上传文件
              </button>
            </>
          ) : null}
          {state.mode === "group" ? (
            <button type="button" onClick={onClose}>关闭</button>
          ) : null}
        </div>
      </header>
      <div className="drive-toolbar">
        <label className="drive-search">
          <ChatIcon name="search" />
          <input
            value={state.search}
            placeholder={state.mode === "group" ? "搜索群文件..." : "搜索文件..."}
            onChange={(event) => onSearch(event.currentTarget.value)}
          />
        </label>
        <select value={state.sortMode} onChange={(event) => onSort(event.currentTarget.value as DriveSortMode)}>
          <option value="updated">按修改时间</option>
          <option value="name">按名称</option>
          <option value="size">按大小</option>
          <option value="type">按类型</option>
        </select>
        <div className="drive-view-toggle">
          <button
            type="button"
            className={state.viewMode === "list" ? "is-active" : ""}
            onClick={() => onViewMode("list")}
          >
            列表
          </button>
          <button
            type="button"
            className={state.viewMode === "grid" ? "is-active" : ""}
            onClick={() => onViewMode("grid")}
          >
            宫格
          </button>
        </div>
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
          {state.mode === "group" ? "群网盘" : "我的网盘"}
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
              canManage={canManage}
              onOpen={() => onOpenNode(node)}
              onDownload={() => onDownloadNode(node)}
              onForward={() => onForwardNode(node)}
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
  canManage: _canManage,
  onOpen,
  onDownload,
  onForward,
}: {
  node: DriveNode;
  viewMode: DriveViewMode;
  canManage: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onForward: () => void;
}) {
  const isFolder = node.type === "folder";
  const size = node.file?.sizeBytes ?? 0;
  const updated = formatDriveDate(node.updatedAt || node.createdAt);
  return (
    <article className={`drive-node-card is-${viewMode}`} onDoubleClick={onOpen}>
      <button type="button" className="drive-node-main" onClick={onOpen}>
        <span className={`drive-node-icon tone-${isFolder ? "folder" : driveNodeFileTone(node)}`}>
          {isFolder ? "F" : driveNodeShortLabel(node)}
        </span>
        <span>
          <strong title={node.name}>{node.name}</strong>
          <em>
            {isFolder ? "文件夹" : `${fileKindLabel(node.name)} · ${size ? formatBytes(size) : "未知大小"}`}
          </em>
        </span>
      </button>
      {viewMode === "list" ? (
        <>
          <span className="drive-node-date">{updated}</span>
          <span className="drive-node-size">{isFolder ? "--" : formatBytes(size)}</span>
        </>
      ) : null}
      <footer>
        {!isFolder ? <button type="button" onClick={onDownload}>下载</button> : null}
        {!isFolder ? <button type="button" onClick={onForward}>转发</button> : null}
        <button type="button" onClick={onOpen}>{isFolder ? "打开" : "预览"}</button>
      </footer>
    </article>
  );
}

function CreateGroupDialog({
  friends,
  groupType,
  loading,
  error,
  search,
  groupName,
  selectedIds,
  submitting,
  onSearchChange,
  onGroupNameChange,
  onToggleFriend,
  onAddFriend,
  onClose,
  onSubmit,
}: {
  friends: UserProfile[];
  groupType: CreateGroupType;
  loading: boolean;
  error?: string | null;
  search: string;
  groupName: string;
  selectedIds: number[];
  submitting: boolean;
  onSearchChange: (value: string) => void;
  onGroupNameChange: (value: string) => void;
  onToggleFriend: (userId: number) => void;
  onAddFriend: () => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const filteredFriends = normalizedSearch
    ? friends.filter((friend) =>
        `${friend.nickname} ${friend.bio ?? ""} ${friend.userId}`
          .toLowerCase()
          .includes(normalizedSearch),
      )
    : friends;
  const selectedFriends = selectedIds
    .map((userId) => friends.find((friend) => friend.userId === userId))
    .filter(Boolean) as UserProfile[];
  const defaultName = buildDefaultGroupName(selectedFriends);
  const isClassGroup = groupType === "class";
  const hasSelectedClassAccount = selectedFriends.some(
    (friend) => friend.accountType === "class",
  );
  const submitDisabled =
    submitting || selectedIds.length === 0 || (isClassGroup && !hasSelectedClassAccount);

  return (
    <div className="chat-modal-backdrop group-create-backdrop" onClick={onClose}>
      <section
        className="group-create-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>{isClassGroup ? "创建班级群" : "创建群聊"}</h2>
            <p>
              {isClassGroup
                ? "必须至少选择 1 个班级账号，创建后将直接入群"
                : "已选 " + selectedIds.length + " 人，创建后将直接入群"}
            </p>
          </div>
          <button type="button" title="关闭" disabled={submitting} onClick={onClose}>
            ×
          </button>
        </header>

        <div className="group-create-body">
          <section className="group-create-friends">
            <label className="group-create-name-field">
              <span>群名称</span>
              <input
                value={groupName}
                maxLength={80}
                placeholder={defaultName || "默认使用成员昵称组合"}
                onChange={(event) => onGroupNameChange(event.target.value)}
              />
            </label>
            <label className="group-create-search">
              <ChatIcon name="search" />
              <input
                value={search}
                placeholder="搜索好友"
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </label>
            <div className="group-create-friend-list">
              {loading && friends.length === 0 ? (
                <p className="group-create-message">正在加载好友...</p>
              ) : null}
              {filteredFriends.length > 0 ? (
                filteredFriends.map((friend) => {
                  const selected = selectedIds.includes(friend.userId);
                  return (
                    <button
                      key={friend.userId}
                      type="button"
                      className={`group-create-friend ${selected ? "is-selected" : ""}`}
                      onClick={() => onToggleFriend(friend.userId)}
                    >
                      <span className="group-create-check">
                        {selected ? "✓" : ""}
                      </span>
                      <ProfileAvatarLite profile={friend} />
                      <span>
                        <strong>{friend.nickname}</strong>
                        <em>
                          {friend.accountType === "class" ? (
                            <ClassBadge label={friend.classNo ? `班级 ${friend.classNo}` : "班级账号"} />
                          ) : null}
                          {friend.bio || `ID ${friend.userId}`}
                        </em>
                      </span>
                    </button>
                  );
                })
              ) : loading ? null : (
                <div className="group-create-empty">
                  <p>{friends.length === 0 ? "暂无好友" : "没有匹配的好友"}</p>
                  {friends.length === 0 ? (
                    <button type="button" onClick={onAddFriend}>
                      添加好友
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          <aside className="group-create-selected">
            <h3>已选好友({selectedFriends.length})</h3>
            <div>
              {selectedFriends.length > 0 ? (
                selectedFriends.map((friend) => (
                  <button
                    key={friend.userId}
                    type="button"
                    onClick={() => onToggleFriend(friend.userId)}
                  >
                    <ProfileAvatarLite profile={friend} />
                    <span>
                      {friend.nickname}
                      {friend.accountType === "class" ? <ClassBadge label="班" /> : null}
                    </span>
                    <i>×</i>
                  </button>
                ))
              ) : (
                <p>从左侧选择好友</p>
              )}
            </div>
          </aside>
        </div>

        {isClassGroup && selectedIds.length > 0 && !hasSelectedClassAccount ? (
          <p className="group-create-error">创建班级群必须至少选择 1 个班级账号</p>
        ) : error ? (
          <p className="group-create-error">{friendlyError(error)}</p>
        ) : null}

        <footer>
          <button type="button" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="profile-primary-button"
            disabled={submitDisabled}
            onClick={onSubmit}
          >
            {submitting ? "创建中..." : "确定"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function InviteGroupDialog({
  friends,
  loading,
  error,
  notice,
  approvalRequired,
  search,
  selectedIds,
  submitting,
  memberCount,
  memberLimit,
  onSearchChange,
  onToggleFriend,
  onAddFriend,
  onClose,
  onSubmit,
}: {
  friends: UserProfile[];
  loading: boolean;
  error?: string | null;
  notice?: string | null;
  approvalRequired: boolean;
  search: string;
  selectedIds: number[];
  submitting: boolean;
  memberCount: number;
  memberLimit: number;
  onSearchChange: (value: string) => void;
  onToggleFriend: (userId: number) => void;
  onAddFriend: () => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const filteredFriends = normalizedSearch
    ? friends.filter((friend) =>
        `${friend.nickname} ${friend.bio ?? ""} ${friend.userId}`
          .toLowerCase()
          .includes(normalizedSearch),
      )
    : friends;
  const selectedFriends = selectedIds
    .map((userId) => friends.find((friend) => friend.userId === userId))
    .filter(Boolean) as UserProfile[];
  const remainingCount = Math.max(0, memberLimit - memberCount);

  return (
    <div className="chat-modal-backdrop group-create-backdrop" onClick={onClose}>
      <section
        className="group-create-dialog is-invite"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>{approvalRequired ? "申请邀请成员" : "邀请成员"}</h2>
            <p>
              {approvalRequired
                ? `已选 ${selectedIds.length} 人，提交后等待群主或管理员处理`
                : `已选 ${selectedIds.length} 人，还可邀请 ${remainingCount} 人`}
            </p>
          </div>
          <button type="button" title="关闭" disabled={submitting} onClick={onClose}>
            ×
          </button>
        </header>

        <div className="group-create-body">
          <section className="group-create-friends">
            <label className="group-create-search">
              <ChatIcon name="search" />
              <input
                value={search}
                placeholder="搜索好友"
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </label>
            <div className="group-create-friend-list">
              {loading && friends.length === 0 ? (
                <p className="group-create-message">正在加载好友...</p>
              ) : null}
              {filteredFriends.length > 0 ? (
                filteredFriends.map((friend) => {
                  const selected = selectedIds.includes(friend.userId);
                  return (
                    <button
                      key={friend.userId}
                      type="button"
                      className={`group-create-friend ${selected ? "is-selected" : ""}`}
                      onClick={() => onToggleFriend(friend.userId)}
                    >
                      <span className="group-create-check">
                        {selected ? "✓" : ""}
                      </span>
                      <ProfileAvatarLite profile={friend} />
                      <span>
                        <strong>{friend.nickname}</strong>
                        <em>{friend.bio || `ID ${friend.userId}`}</em>
                      </span>
                    </button>
                  );
                })
              ) : loading ? null : (
                <div className="group-create-empty">
                  <p>{friends.length === 0 ? "暂无可邀请好友" : "没有匹配的好友"}</p>
                  {friends.length === 0 ? (
                    <button type="button" onClick={onAddFriend}>
                      添加好友
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          <aside className="group-create-selected">
            <h3>已选好友({selectedFriends.length})</h3>
            <div>
              {selectedFriends.length > 0 ? (
                selectedFriends.map((friend) => (
                  <button
                    key={friend.userId}
                    type="button"
                    onClick={() => onToggleFriend(friend.userId)}
                  >
                    <ProfileAvatarLite profile={friend} />
                    <span>{friend.nickname}</span>
                    <i>×</i>
                  </button>
                ))
              ) : (
                <p>从左侧选择好友</p>
              )}
            </div>
          </aside>
        </div>

        {error ? <p className="group-create-error">{friendlyError(error)}</p> : null}
        {notice ? <p className="group-create-notice">{notice}</p> : null}

        <footer>
          <button type="button" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="profile-primary-button"
            disabled={submitting || selectedIds.length === 0}
            onClick={onSubmit}
          >
            {submitting ? "提交中..." : approvalRequired ? "提交申请" : "确定"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function RemoveGroupMembersDialog({
  members,
  profiles,
  currentUserId,
  currentRole,
  search,
  selectedIds,
  submitting,
  error,
  onSearchChange,
  onToggleMember,
  onClose,
  onSubmit,
}: {
  members: ChatGroupMember[];
  profiles: Record<number, UserProfile>;
  currentUserId: number;
  currentRole: string;
  search: string;
  selectedIds: number[];
  submitting: boolean;
  error?: string | null;
  onSearchChange: (value: string) => void;
  onToggleMember: (userId: number) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const removableMembers = members
    .filter((member) =>
      canRemoveGroupMember(currentRole, member, currentUserId),
    )
    .map((member) => ({
      member,
      profile: profiles[member.userId] ?? null,
    }));
  const normalizedSearch = search.trim().toLowerCase();
  const filteredMembers = normalizedSearch
    ? removableMembers.filter(({ member, profile }) =>
        `${member.nickname} ${member.groupNickname ?? ""} ${profile?.nickname ?? ""} ${member.userId}`
          .toLowerCase()
          .includes(normalizedSearch),
      )
    : removableMembers;
  const selectedMembers = selectedIds
    .map((userId) => removableMembers.find(({ member }) => member.userId === userId))
    .filter(Boolean) as { member: ChatGroupMember; profile: UserProfile | null }[];

  return (
    <div className="chat-modal-backdrop group-create-backdrop" onClick={onClose}>
      <section
        className="group-create-dialog is-invite"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>移除成员</h2>
            <p>已选 {selectedIds.length} 人，移除前会再次确认</p>
          </div>
          <button type="button" title="关闭" disabled={submitting} onClick={onClose}>
            ×
          </button>
        </header>

        <div className="group-create-body">
          <section className="group-create-friends">
            <label className="group-create-search">
              <ChatIcon name="search" />
              <input
                value={search}
                placeholder="搜索成员"
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </label>
            <div className="group-create-friend-list">
              {filteredMembers.length > 0 ? (
                filteredMembers.map(({ member, profile }) => {
                  const selected = selectedIds.includes(member.userId);
                  const displayProfile =
                    profile ??
                    ({
                      userId: member.userId,
                      nickname: member.nickname,
                      avatarUrl: member.avatarUrl,
                      avatarObjectKey: member.avatarObjectKey,
                      online: false,
                      friendStatus: "unknown",
                    } as UserProfile);
                  return (
                    <button
                      key={member.userId}
                      type="button"
                      className={`group-create-friend ${selected ? "is-selected" : ""}`}
                      onClick={() => onToggleMember(member.userId)}
                    >
                      <span className="group-create-check">
                        {selected ? "✓" : ""}
                      </span>
                      <ProfileAvatarLite profile={displayProfile} />
                      <span>
                        <strong>
                          {member.groupNickname || profile?.nickname || member.nickname}
                        </strong>
                        <em>
                          {member.role === "admin" ? "管理员" : `ID ${member.userId}`}
                        </em>
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="group-create-empty">
                  <p>
                    {removableMembers.length === 0
                      ? "暂无可移除成员"
                      : "没有匹配的成员"}
                  </p>
                </div>
              )}
            </div>
          </section>

          <aside className="group-create-selected">
            <h3>待移除({selectedMembers.length})</h3>
            <div>
              {selectedMembers.length > 0 ? (
                selectedMembers.map(({ member, profile }) => {
                  const displayProfile =
                    profile ??
                    ({
                      userId: member.userId,
                      nickname: member.nickname,
                      avatarUrl: member.avatarUrl,
                      avatarObjectKey: member.avatarObjectKey,
                      online: false,
                      friendStatus: "unknown",
                    } as UserProfile);
                  return (
                    <button
                      key={member.userId}
                      type="button"
                      onClick={() => onToggleMember(member.userId)}
                    >
                      <ProfileAvatarLite profile={displayProfile} />
                      <span>
                        {member.groupNickname || profile?.nickname || member.nickname}
                      </span>
                      <i>×</i>
                    </button>
                  );
                })
              ) : (
                <p>从左侧选择成员</p>
              )}
            </div>
          </aside>
        </div>

        {error ? <p className="group-create-error">{friendlyError(error)}</p> : null}

        <footer>
          <button type="button" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="profile-primary-button danger"
            disabled={submitting || selectedIds.length === 0}
            onClick={onSubmit}
          >
            {submitting ? "处理中..." : "移除"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function GroupOverviewPanel({
  conversation,
  group,
  members,
  profiles,
  currentUserId,
  loading,
  search,
  hidden,
  searchOpen,
  onSearchChange,
  onToggleHidden,
  onToggleSearch,
  onOpenAnnouncement,
  onMemberHover,
  onMemberLeave,
  onOpenMemberMenu,
}: {
  conversation: ChatConversation;
  group: ChatGroup | null;
  members: ChatGroupMember[];
  profiles: Record<number, UserProfile>;
  currentUserId: number;
  loading: boolean;
  search: string;
  hidden: boolean;
  searchOpen: boolean;
  onSearchChange: (value: string) => void;
  onToggleHidden: () => void;
  onToggleSearch: () => void;
  onOpenAnnouncement: () => void;
  onMemberHover: (profile: UserProfile, element: HTMLElement) => void;
  onMemberLeave: () => void;
  onOpenMemberMenu: (event: MouseEvent<HTMLElement>, userId: number) => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const displayMembers = members.map((member) => ({
    member,
    profile: profiles[member.userId] ?? null,
  }));
  const filteredMembers = normalizedSearch
    ? displayMembers.filter(({ member, profile }) =>
        `${member.nickname} ${member.groupNickname ?? ""} ${profile?.nickname ?? ""} ${member.userId}`
          .toLowerCase()
          .includes(normalizedSearch),
      )
    : displayMembers;
  const memberCount = group?.memberCount ?? conversation.groupMemberCount ?? members.length;
  const groupNo = formatGroupNo(group, conversation.groupId || conversation.id);

  return (
    <aside className={`group-overview-panel ${hidden ? "is-collapsed" : ""}`}>
      <button
        type="button"
        className="group-overview-toggle"
        title={hidden ? "展开群资料" : "隐藏群资料"}
        onClick={onToggleHidden}
      >
        {hidden ? "‹" : "›"}
      </button>
      {hidden ? null : (
        <>
          <section className="group-overview-section group-announcement-section">
            <div className="group-overview-title">
              <h3>群公告</h3>
              <button type="button" title="查看群公告" onClick={onOpenAnnouncement}>
                ›
              </button>
            </div>
            <p className={group?.announcement ? "" : "is-muted"}>
              {group?.announcement || "暂无群公告"}
            </p>
          </section>

          <section className="group-overview-section group-overview-members">
            <div className="group-overview-title">
              {searchOpen ? (
                <label className="group-overview-search is-open">
                  <ChatIcon name="search" />
                  <input
                    autoFocus
                    value={search}
                    placeholder="搜索"
                    onChange={(event) => onSearchChange(event.target.value)}
                    onBlur={() => {
                      if (!search.trim()) {
                        onToggleSearch();
                      }
                    }}
                  />
                </label>
              ) : (
                <>
                  <h3>群聊成员 {memberCount}</h3>
                  <button
                    type="button"
                    className="group-overview-search-button"
                    title="搜索成员"
                    onClick={onToggleSearch}
                  >
                    <ChatIcon name="search" />
                  </button>
                </>
              )}
            </div>
            <div className="group-overview-member-list">
              {loading && members.length === 0 ? (
                <p className="group-member-message">正在加载成员...</p>
              ) : null}
              {filteredMembers.length > 0 ? (
                filteredMembers.map(({ member, profile }) => {
                  const displayProfile =
                    profile ??
                    ({
                      userId: member.userId,
                      nickname: member.nickname,
                      avatarUrl: member.avatarUrl,
                      avatarObjectKey: member.avatarObjectKey,
                      online: false,
                      friendStatus:
                        member.userId === currentUserId ? "self" : "unknown",
                    } as UserProfile);
                  return (
                    <button
                      key={member.userId}
                      type="button"
                      className="group-overview-member-row"
                      onMouseEnter={(event) =>
                        onMemberHover(displayProfile, event.currentTarget)
                      }
                      onMouseLeave={onMemberLeave}
                      onContextMenu={(event) => onOpenMemberMenu(event, member.userId)}
                    >
                      <ProfileAvatarLite profile={displayProfile} />
                      <span>
                        {member.groupNickname || profile?.nickname || member.nickname}
                      </span>
                      <GroupRoleBadge role={member.role} />
                    </button>
                  );
                })
              ) : loading ? null : (
                <p className="group-member-message">没有匹配成员</p>
              )}
            </div>
          </section>
        </>
      )}
    </aside>
  );
}

function GroupSettingsDrawer({
  drawerRef,
  open,
  conversation,
  group,
  members,
  profiles,
  currentUserId,
  view,
  editing,
  draft,
  saving,
  nicknameEditing,
  nicknameDraft,
  nicknameSaving,
  editError,
  onEdit,
  onOpenAnnouncement,
  onBack,
  onCancelEdit,
  onSaveEdit,
  onDraftChange,
  onStartNicknameEdit,
  onCancelNicknameEdit,
  onNicknameDraftChange,
  onSaveNickname,
  onTogglePinned,
  onToggleMuted,
  onClearHistory,
  onSelectAvatar,
  onShareGroup,
  onInvite,
  onRemove,
  onMemberMenu,
  onLeave,
  onDissolve,
}: {
  drawerRef: RefObject<HTMLElement | null>;
  open: boolean;
  conversation: ChatConversation;
  group: ChatGroup | null;
  members: ChatGroupMember[];
  profiles: Record<number, UserProfile>;
  currentUserId: number;
  view: GroupSettingsView;
  editing: boolean;
  draft: {
    name: string;
    avatarUrl: string | null;
    avatarObjectKey: string | null;
    description: string;
    announcement: string;
  };
  saving: boolean;
  nicknameEditing: boolean;
  nicknameDraft: string;
  nicknameSaving: boolean;
  editError?: string | null;
  onEdit: () => void;
  onOpenAnnouncement: () => void;
  onBack: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDraftChange: (draft: {
    name: string;
    avatarUrl: string | null;
    avatarObjectKey: string | null;
    description: string;
    announcement: string;
  }) => void;
  onStartNicknameEdit: () => void;
  onCancelNicknameEdit: () => void;
  onNicknameDraftChange: (value: string) => void;
  onSaveNickname: (value?: string) => void;
  onTogglePinned: () => void;
  onToggleMuted: () => void;
  onClearHistory: () => void;
  onSelectAvatar: () => void;
  onShareGroup: () => void;
  onInvite: () => void;
  onRemove: () => void;
  onMemberMenu: (event: MouseEvent<HTMLElement>, userId: number) => void;
  onLeave: () => void;
  onDissolve: () => void;
}) {
  const memberCount = group?.memberCount ?? conversation.groupMemberCount ?? members.length;
  const canEdit = group?.currentUserRole === "owner" || group?.currentUserRole === "admin";
  const myMember = members.find((member) => member.userId === currentUserId);
  const groupTitle = group?.name || conversation.title;
  const groupAvatarUrl = groupDisplayAvatarUrl(group, conversation);
  const groupNo = formatGroupNo(group, conversation.groupId || conversation.id);
  const previewMembers = members.slice(0, canEdit ? 8 : 9).map((member) => {
    const profile = profiles[member.userId] ?? null;
    const displayProfile =
      profile ??
      ({
        userId: member.userId,
        nickname: member.nickname,
        avatarUrl: member.avatarUrl,
        avatarObjectKey: member.avatarObjectKey,
        online: false,
        friendStatus: member.userId === currentUserId ? "self" : "unknown",
      } as UserProfile);
    return { member, profile: displayProfile };
  });
  const myGroupNickname = myMember?.groupNickname || myMember?.nickname || "";

  const renderSettingRow = ({
    label,
    value,
    onClick,
    danger = false,
    disabled = false,
  }: {
    label: string;
    value?: string;
    onClick?: () => void;
    danger?: boolean;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      className={`group-settings-row ${danger ? "danger" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span>{label}</span>
      {value ? <em>{value}</em> : null}
      <i>›</i>
    </button>
  );

  const renderSettingField = ({
    label,
    value,
    placeholder,
    onClick,
    danger = false,
    disabled = false,
  }: {
    label: string;
    value?: string;
    placeholder?: string;
    onClick?: () => void;
    danger?: boolean;
    disabled?: boolean;
  }) => (
    <section className={`group-settings-field ${danger ? "danger" : ""}`}>
      <h3>{label}</h3>
      <button
        type="button"
        className="group-settings-field-box"
        disabled={disabled}
        title={disabled ? "后续阶段接入" : undefined}
        onClick={onClick}
      >
        <span className={!value ? "is-placeholder" : ""}>
          {value || placeholder || "未设置"}
        </span>
        <i>›</i>
      </button>
    </section>
  );

  const renderSwitchField = ({
    label,
    checked,
    disabled = false,
  }: {
    label: string;
    checked: boolean;
    disabled?: boolean;
  }) => (
    <section className="group-settings-field">
      <h3>{label}</h3>
      <button
        type="button"
        className="group-settings-field-box"
        disabled={disabled}
        title={disabled ? "后续阶段接入" : undefined}
      >
        <span>{checked ? "已开启" : "未开启"}</span>
        <b className={`group-settings-switch ${checked ? "is-on" : ""}`} />
      </button>
    </section>
  );

  const renderSwitchAction = ({
    label,
    checked,
    disabled = false,
    onClick,
  }: {
    label: string;
    checked: boolean;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button
      type="button"
      className="group-settings-action-box"
      disabled={disabled}
      title={disabled ? "后续阶段接入" : undefined}
      onClick={onClick}
    >
      <span>{label}</span>
      <b className={`group-settings-switch ${checked ? "is-on" : ""}`} />
    </button>
  );

  return (
    <aside
      ref={drawerRef}
      className={`group-settings-drawer ${open ? "is-open" : ""}`}
      aria-hidden={!open}
    >
      <div className="group-settings-drawer-scroll">
        {view === "main" ? (
          <>
            <section className="group-settings-card group-overview-profile group-settings-profile-card">
              <Avatar
                label={(groupTitle || "群").slice(0, 1)}
                imageUrl={groupAvatarUrl}
                tone="group"
              />
              <div className="group-overview-profile-main">
                <strong>{groupTitle || "群聊"}</strong>
                <span>群号：{groupNo}</span>
              </div>
              <button
                type="button"
                className="group-overview-share-button"
                onClick={onShareGroup}
              >
                <ChatIcon name="share" />
                分享
              </button>
            </section>

            <section className="group-settings-card group-settings-members">
              <div className="group-settings-title-row">
                <h3>群聊成员</h3>
                <span>{memberCount}</span>
              </div>
              <div className="group-settings-member-grid">
                {previewMembers.map(({ member, profile }) => (
                  <button
                    key={member.userId}
                    type="button"
                    onContextMenu={(event) => onMemberMenu(event, member.userId)}
                  >
                    <ProfileAvatarLite profile={profile} />
                    <span>
                      {shortMemberName(
                        member.groupNickname || profile.nickname || member.nickname,
                      )}
                    </span>
                  </button>
                ))}
                <button type="button" className="group-settings-member-action" onClick={onInvite}>
                  <span>+</span>
                  <em>{canEdit ? "添加" : "申请"}</em>
                </button>
                {canEdit ? (
                  <button type="button" className="group-settings-member-action" onClick={onRemove}>
                    <span>-</span>
                    <em>移除</em>
                  </button>
                ) : null}
              </div>
            </section>

            <section className="group-settings-section">
              <h3>资料管理</h3>
              {renderSettingRow({
                label: "群资料设置",
                onClick: onEdit,
              })}
            </section>

            {renderSettingField({
              label: "群公告",
              value: group?.announcement || "",
              placeholder: "未设置",
              onClick: onOpenAnnouncement,
            })}

            <section className="group-settings-field">
              <h3>我的本群昵称</h3>
              {nicknameEditing ? (
                <input
                  className="group-settings-inline-input"
                  value={nicknameDraft}
                  maxLength={GROUP_NICKNAME_MAX_LENGTH}
                  disabled={nicknameSaving}
                  autoFocus
                  onChange={(event) => onNicknameDraftChange(event.target.value)}
                  onBlur={(event) => {
                    if (event.currentTarget.dataset.cancelEdit === "true") {
                      delete event.currentTarget.dataset.cancelEdit;
                      return;
                    }
                    onSaveNickname(event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onSaveNickname(event.currentTarget.value);
                    }
                    if (event.key === "Escape") {
                      event.currentTarget.dataset.cancelEdit = "true";
                      event.preventDefault();
                      onCancelNicknameEdit();
                      event.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="group-settings-action-box"
                  title="双击编辑"
                  onDoubleClick={onStartNicknameEdit}
                >
                  <span className={!myGroupNickname ? "is-placeholder" : ""}>
                    {myGroupNickname || "未设置"}
                  </span>
                </button>
              )}
            </section>

            {renderSwitchAction({
              label: "设置置顶",
              checked: conversation.pinned,
              onClick: onTogglePinned,
            })}

            {renderSwitchAction({
              label: "消息免打扰",
              checked: conversation.muted,
              onClick: onToggleMuted,
            })}

            <button
              type="button"
              className="group-settings-action-box is-danger"
              onClick={onClearHistory}
            >
              <span>删除聊天记录</span>
            </button>

            <section className="group-settings-danger">
              {group?.currentUserRole !== "owner" ? (
                <button type="button" onClick={onLeave}>退出群聊</button>
              ) : null}
              {group?.currentUserRole === "owner" ? (
                <button type="button" onClick={onDissolve}>解散群聊</button>
              ) : null}
            </section>
          </>
        ) : null}

        {view === "profile" ? (
          <section className="group-settings-subpage">
            <header className="group-settings-subheader">
              <button type="button" disabled={saving} onClick={onBack}>‹</button>
              <h2>群资料设置</h2>
            </header>

            <button
              type="button"
              className={`group-profile-avatar-editor ${canEdit ? "" : "is-readonly"}`}
              disabled={!canEdit || saving}
              onClick={onSelectAvatar}
            >
              <Avatar
                label={conversation.participant.avatar}
                imageUrl={draft.avatarUrl || groupAvatarUrl}
                tone="group"
              />
              {canEdit ? <span>编辑</span> : null}
            </button>

            <section className="group-settings-card group-settings-form">
              <label>
                <span>群聊名称</span>
                <input
                  value={draft.name}
                  maxLength={80}
                  disabled={!canEdit || saving}
                  onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
                />
              </label>
              <label>
                <span>群介绍</span>
                <textarea
                  value={draft.description}
                  maxLength={500}
                  disabled={!canEdit || saving}
                  placeholder="未设置"
                  onChange={(event) =>
                    onDraftChange({ ...draft, description: event.target.value })
                  }
                />
              </label>
            </section>

            {editError ? <p className="group-settings-error">{editError}</p> : null}

            {canEdit ? (
              <footer className="group-settings-subactions">
                <button type="button" disabled={saving} onClick={onCancelEdit}>取消</button>
                <button
                  type="button"
                  className="profile-primary-button"
                  disabled={saving}
                  onClick={onSaveEdit}
                >
                  {saving ? "保存中..." : "保存"}
                </button>
              </footer>
            ) : null}
          </section>
        ) : null}

      </div>
    </aside>
  );
}

function DirectSettingsDrawer({
  drawerRef,
  open,
  conversation,
  onTogglePinned,
  onToggleMuted,
  onClearHistory,
  onDeleteFriend,
}: {
  drawerRef: RefObject<HTMLElement | null>;
  open: boolean;
  conversation: ChatConversation;
  onTogglePinned: () => void;
  onToggleMuted: () => void;
  onClearHistory: () => void;
  onDeleteFriend: () => void;
}) {
  const renderSwitchAction = ({
    label,
    checked,
    onClick,
  }: {
    label: string;
    checked: boolean;
    onClick: () => void;
  }) => (
    <button type="button" className="group-settings-action-box" onClick={onClick}>
      <span>{label}</span>
      <b className={`group-settings-switch ${checked ? "is-on" : ""}`} />
    </button>
  );

  return (
    <aside
      ref={drawerRef}
      className={`group-settings-drawer direct-settings-drawer ${
        open ? "is-open" : ""
      }`}
      aria-hidden={!open}
    >
      <div className="group-settings-drawer-scroll">
        <section className="group-settings-section">
          <h3>会话设置</h3>
          {renderSwitchAction({
            label: "设为置顶",
            checked: conversation.pinned,
            onClick: onTogglePinned,
          })}
          {renderSwitchAction({
            label: "消息免打扰",
            checked: conversation.muted,
            onClick: onToggleMuted,
          })}
        </section>

        <section className="group-settings-section">
          <h3>聊天管理</h3>
          <button
            type="button"
            className="group-settings-action-box is-danger"
            onClick={onClearHistory}
          >
            <span>删除聊天记录</span>
          </button>
        </section>

        <section className="group-settings-danger">
          <button type="button" onClick={onDeleteFriend}>删除好友</button>
        </section>
      </div>
    </aside>
  );
}

function GroupRoleBadge({ role }: { role: string }) {
  if (role === "owner") {
    return <i className="group-role-badge is-owner">群主</i>;
  }
  if (role === "admin") {
    return <i className="group-role-badge is-admin">管理员</i>;
  }
  return <i className="group-role-badge">成员</i>;
}

function EmojiStickerPanel({
  panelRef,
  activeTab,
  onChangeTab,
  onInsertEmoji,
  stickers,
  uploading,
  onUpload,
  onSend,
}: {
  panelRef: RefObject<HTMLElement | null>;
  activeTab: EmojiPanelTab;
  onChangeTab: (tab: EmojiPanelTab) => void;
  onInsertEmoji: (emoji: string) => void;
  stickers: ChatSticker[];
  uploading: boolean;
  onUpload: () => void;
  onSend: (sticker: ChatSticker) => void;
}) {
  return (
    <section
      ref={panelRef}
      className="sticker-panel"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="sticker-panel-content">
        {activeTab === "emoji" ? (
          <div className="emoji-grid">
            {COMMON_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="emoji-option"
                onClick={() => onInsertEmoji(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : (
          <div className="sticker-tab-content">
            <div className="sticker-action-row">
              <span>收藏表情</span>
              <button
                type="button"
                className="sticker-upload-button"
                disabled={uploading}
                onClick={onUpload}
              >
                {uploading ? "上传中..." : "上传"}
              </button>
            </div>
            {stickers.length > 0 ? (
              <div className="sticker-grid">
                {stickers.map((sticker) => (
                  <StickerThumb
                    key={sticker.fileObjectId}
                    sticker={sticker}
                    onClick={() => onSend(sticker)}
                  />
                ))}
              </div>
            ) : (
              <div className="sticker-empty">
                <p>暂无收藏表情</p>
                <span>支持 PNG / GIF / WebP</span>
              </div>
            )}
          </div>
        )}
      </div>
      <footer className="sticker-panel-tabs">
        <button
          type="button"
          className={activeTab === "emoji" ? "is-active" : ""}
          title="Emoji"
          onClick={() => onChangeTab("emoji")}
        >
          <ChatIcon name="smile" />
        </button>
        <button
          type="button"
          className={activeTab === "stickers" ? "is-active" : ""}
          title="收藏表情"
          onClick={() => onChangeTab("stickers")}
        >
          <span className="sticker-heart-icon" aria-hidden="true" />
        </button>
      </footer>
    </section>
  );
}

function StickerThumb({
  sticker,
  onClick,
}: {
  sticker: ChatSticker;
  onClick: () => void;
}) {
  const [url, setUrl] = useState(sticker.fileObjectId ? "" : sticker.url || "");
  useEffect(() => {
    if (url || !sticker.fileObjectId) {
      return;
    }
    let disposed = false;
    void cacheChatFile(sticker.fileObjectId, sticker.fileName || "表情")
      .then((nextUrl) => {
        if (!disposed) {
          setUrl(nextUrl);
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [sticker.fileName, sticker.fileObjectId, url]);

  return (
    <button type="button" className="sticker-thumb" title={sticker.fileName} onClick={onClick}>
      {url ? <img src={url} alt={sticker.fileName} /> : <span>表情</span>}
    </button>
  );
}

function TimelineDivider({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const compactTime = formatChatTimelineTime(message);
  const fullTime = formatFullChatTime(message);
  if (!compactTime) {
    return null;
  }
  return (
    <button
      type="button"
      className={`chat-timeline-divider ${expanded ? "is-expanded" : ""}`}
      onClick={() => setExpanded((current) => !current)}
    >
      {expanded && fullTime ? fullTime : compactTime}
    </button>
  );
}

function MessageRenderer({
  message,
  conversation,
  myProfile,
  profiles,
  multiSelectMode,
  selected,
  highlighted,
  onOpenFriendProfile,
  onHoverFriendProfile,
  onLeaveFriendProfile,
  onOpenContactCard,
  onOpenGroupCard,
  onPreviewImage,
  onPlayVideo,
  onOpenContextMenu,
  onToggleSelected,
  onDownloadFile,
  onLocateQuote,
}: {
  message: ChatMessage;
  conversation: ChatConversation;
  myProfile: UserProfile | null;
  profiles: Record<number, UserProfile>;
  multiSelectMode: boolean;
  selected: boolean;
  highlighted: boolean;
  onOpenFriendProfile: (userId?: number) => void;
  onHoverFriendProfile: (userId: number, element: HTMLElement) => void;
  onLeaveFriendProfile: () => void;
  onOpenContactCard: (message: ChatMessage) => void;
  onOpenGroupCard: (message: ChatMessage) => void;
  onPreviewImage: (message: ChatMessage) => void;
  onPlayVideo: (message: ChatMessage) => void;
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void;
  onToggleSelected: () => void;
  onDownloadFile: (message: ChatMessage) => void;
  onLocateQuote: (quote: NonNullable<ReturnType<typeof quoteFromMessage>>) => void;
}) {
  if (message.status === "revoked") {
    return (
      <div className="message-system">
        {revokedMessageText(message)}
      </div>
    );
  }

  if (message.kind === "system") {
    return <div className="message-system">{message.content}</div>;
  }

  const direction = message.direction ?? "incoming";
  const senderProfile =
    direction === "incoming" && message.senderId
      ? profiles[message.senderId] ?? null
      : null;
  const senderAvatarLabel =
    conversation.kind === "group" && senderProfile
      ? avatarLabel(senderProfile, conversation.participant.avatar)
      : conversation.participant.avatar;
  const senderAvatarUrl =
    conversation.kind === "group" && senderProfile
      ? senderProfile.avatarUrl
      : conversation.participant.avatarUrl;
  const senderName =
    conversation.kind === "group"
      ? senderProfile?.nickname || (message.senderId ? `用户${message.senderId}` : "")
      : "";
  const quote = quoteFromMessage(message);
  return (
    <div
      className={`message-row ${direction} ${selected ? "is-selected" : ""} ${
        highlighted ? "is-highlighted" : ""
      }`}
      data-message-id={message.id}
    >
      {multiSelectMode ? (
        <button
          type="button"
          className={`message-select-toggle ${selected ? "is-selected" : ""}`}
          title="选择消息"
          onClick={onToggleSelected}
        >
          {selected ? "✓" : ""}
        </button>
      ) : null}
      {direction === "incoming" ? (
        <button
          type="button"
          className="chat-avatar-button"
          onMouseEnter={(event) => {
            if (message.senderId) {
              onHoverFriendProfile(message.senderId, event.currentTarget);
            }
          }}
          onMouseLeave={onLeaveFriendProfile}
          onClick={() => onOpenFriendProfile(message.senderId)}
        >
          <Avatar
            label={senderAvatarLabel}
            imageUrl={senderAvatarUrl}
            tone={conversation.kind === "group" ? "direct" : conversation.kind}
          />
        </button>
      ) : null}
      <div
        className={`message-bubble message-kind-${message.kind}`}
        onClick={multiSelectMode ? onToggleSelected : undefined}
        onContextMenu={(event) => onOpenContextMenu(event, message)}
      >
        {direction === "incoming" && senderName ? (
          <div className="message-sender-name">{senderName}</div>
        ) : null}
        {quote ? (
          <MessageQuoteBlock quote={quote} onLocate={() => onLocateQuote(quote)} />
        ) : null}
        {message.kind === "image" ? (
          <ImageMessageRenderer
            message={message}
            onPreview={() => onPreviewImage(message)}
          />
        ) : isVideoMessage(message) ? (
          <VideoMessageRenderer
            message={message}
            onPlay={() => onPlayVideo(message)}
          />
        ) : message.kind === "sticker" ? (
          <StickerMessageRenderer message={message} />
        ) : message.kind === "file" ? (
          <FileMessageRenderer
            message={message}
            onDownload={() => onDownloadFile(message)}
          />
        ) : message.kind === "call_event" ? (
          <CallEventMessageRenderer message={message} />
        ) : message.kind === "contact_card" ? (
          <ContactCardMessageRenderer
            message={message}
            onOpen={() => onOpenContactCard(message)}
          />
        ) : message.kind === "group_card" || message.kind === "group_share_card" ? (
          <GroupCardMessageRenderer
            message={message}
            onOpen={() => onOpenGroupCard(message)}
          />
        ) : (
          <TextMessageRenderer message={message} />
        )}
        <div className="message-meta-row">
          {message.status === "sending" ? <span>发送中</span> : null}
          {message.status === "failed" ? <span className="message-failed">发送失败</span> : null}
        </div>
      </div>
      {direction === "outgoing" ? (
        <Avatar
          label={avatarLabel(myProfile, "我")}
          imageUrl={myProfile?.avatarUrl}
          tone="self"
        />
      ) : null}
    </div>
  );
}

function TextMessageRenderer({ message }: { message: ChatMessage }) {
  return (
    <p>{message.content}</p>
  );
}

function StickerMessageRenderer({ message }: { message: ChatMessage }) {
  const fileObjectId = fileObjectIdFromMessage(message);
  const [url, setUrl] = useState(fileObjectId ? "" : fileUrlFromMessage(message));
  useEffect(() => {
    if (url || !fileObjectId || !chatFileCloudAvailable(message)) {
      return;
    }
    let disposed = false;
    void cacheChatFile(
      fileObjectId,
      fileNameFromMessage(message, "表情"),
      chatMessageFileAccessSource(message),
    )
      .then((nextUrl) => {
        if (!disposed && nextUrl) {
          setUrl(nextUrl);
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [fileObjectId, message, url]);

  if (!url) {
    return (
      <div className="message-sticker-placeholder">
        {chatFileCloudAvailable(message) ? "[表情]" : "表情已过期"}
      </div>
    );
  }
  return (
    <div className="message-sticker">
      <img src={url} alt={fileNameFromMessage(message, "表情")} />
    </div>
  );
}

function ImageMessageRenderer({
  message,
  onPreview,
}: {
  message: ChatMessage;
  onPreview: () => void;
}) {
  const [url, setUrl] = useState("");
  const fileObjectId = fileObjectIdFromMessage(message);
  useEffect(() => {
    if (!fileObjectId) {
      setUrl(fileUrlFromMessage(message));
      return;
    }
    if (!chatFileCloudAvailable(message)) {
      setUrl("");
      return;
    }
    let disposed = false;
    void cacheChatFile(
      fileObjectId,
      fileNameFromMessage(message, "图片"),
      chatMessageFileAccessSource(message),
    )
      .then((nextUrl) => {
        if (!disposed && nextUrl) {
          setUrl(nextUrl);
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [fileObjectId, message]);

  if (!url) {
    return (
      <button type="button" className="message-image-button is-placeholder" onClick={onPreview}>
        <span>{chatFileCloudAvailable(message) ? message.content || "[图片]" : "图片已过期"}</span>
      </button>
    );
  }
  return (
    <button type="button" className="message-image-button" onClick={onPreview}>
      <img src={url} alt={fileNameFromMessage(message, "图片")} />
    </button>
  );
}

function VideoMessageRenderer({
  message,
  onPlay,
}: {
  message: ChatMessage;
  onPlay: () => void;
}) {
  const fileName = fileNameFromMessage(message, "视频");
  const size = sizeBytesFromMessage(message);
  const progress = clampNumber(numberPayload(message.contentJson?.progress) ?? 0, 0, 100);
  const uploadStatus = stringPayload(message.contentJson?.uploadStatus);
  const speed = numberPayload(message.contentJson?.speedBytes);
  const remainingSeconds = numberPayload(message.contentJson?.remainingSeconds);
  const duration = numberPayload(message.contentJson?.duration) ??
    numberPayload(message.contentJson?.durationSeconds);
  const localThumbnailCandidate =
    stringPayload(message.contentJson?.thumbnailLocalUrl) ||
    stringPayload(message.contentJson?.posterLocalUrl) ||
    stringPayload(message.contentJson?.thumbnailLocalPath) ||
    stringPayload(message.contentJson?.posterLocalPath);
  const directThumbnailUrl =
    stringPayload(message.contentJson?.thumbnailUrl) ||
    stringPayload(message.contentJson?.thumbUrl) ||
    stringPayload(message.contentJson?.previewUrl) ||
    stringPayload(message.contentJson?.posterUrl);
  const localThumbnailUrl =
    localMediaUrlPayload(localThumbnailCandidate) ||
    localMediaUrlPayload(directThumbnailUrl);
  const thumbnailObjectId =
    stringPayload(message.contentJson?.thumbnailObjectId) ||
    stringPayload(message.contentJson?.thumbnailFileObjectId) ||
    stringPayload(message.contentJson?.thumbObjectId) ||
    stringPayload(message.contentJson?.posterObjectId);
  const [cachedThumbnailUrl, setCachedThumbnailUrl] = useState(localThumbnailUrl);
  useEffect(() => {
    if (localThumbnailUrl) {
      setCachedThumbnailUrl(localThumbnailUrl);
    }
  }, [localThumbnailUrl]);
  useEffect(() => {
    if (cachedThumbnailUrl || !thumbnailObjectId || !chatFileCloudAvailable(message)) {
      return;
    }
    let disposed = false;
    void cacheChatFile(
      thumbnailObjectId,
      `${fileName}.jpg`,
      chatMessageFileAccessSource(message),
    )
      .then((url) => {
        if (!disposed && url) {
          setCachedThumbnailUrl(url);
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [cachedThumbnailUrl, fileName, thumbnailObjectId]);
  const thumbnailUrl = cachedThumbnailUrl;
  const displayFileName = splitCompactVideoFileName(fileName);
  const uploading =
    message.status === "sending" &&
    uploadStatus &&
    !["completed", "instant_completed"].includes(uploadStatus);
  const failed =
    message.status === "failed" ||
    uploadStatus === "failed" ||
    uploadStatus === "canceled";
  const completed = !uploading && !failed;
  const hasLocalPlaybackCandidate = Boolean(
    stringPayload(message.contentJson?.localPath) ||
      stringPayload(message.contentJson?.filePath) ||
      stringPayload(message.contentJson?.downloadPath) ||
      stringPayload(message.contentJson?.cachePath),
  );
  const cloudUnavailable = isMessageFileDefinitelyUnavailable(message);
  const statusText = failed
    ? "传输中断"
    : cloudUnavailable && !hasLocalPlaybackCandidate
      ? "已过期"
    : completed
      ? message.direction === "outgoing"
        ? "已发送"
        : "已接收"
      : "";
  const metaText = [
    size > 0 ? formatBytes(size) : "未知大小",
    statusText,
  ].filter(Boolean).join(" ");
  const transferLabel =
    uploadStatus === "hashing"
      ? "准备"
      : uploadStatus === "waiting"
        ? "等待"
        : `${Math.round(progress)}%`;
  return (
    <button
      type="button"
      className={`message-video-card ${uploading ? "is-transferring" : ""} ${
        failed ? "is-failed" : ""
      } ${thumbnailUrl ? "has-thumbnail" : ""}`}
      onClick={uploading || failed ? undefined : onPlay}
      aria-label={completed ? `播放视频 ${fileName}` : fileName}
    >
      {thumbnailUrl ? (
        <img className="message-video-thumb" src={thumbnailUrl} alt="" />
      ) : (
        <span className="message-video-thumb is-placeholder" aria-hidden="true" />
      )}
      <span className="message-video-mask" aria-hidden="true" />
      <span className="message-video-center" aria-hidden="true">
        {uploading ? (
          <span className="message-video-progress" style={{ "--video-progress": progress } as CSSProperties}>
            <svg viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="18" />
              <circle cx="22" cy="22" r="18" />
            </svg>
            <span>{transferLabel}</span>
          </span>
        ) : failed ? (
          <span className="message-video-retry">重试</span>
        ) : cloudUnavailable && !hasLocalPlaybackCandidate ? (
          <span className="message-video-retry">过期</span>
        ) : (
          <span className="message-video-play">
            <i />
          </span>
        )}
      </span>
      {duration ? (
        <span className="message-video-duration">{formatDuration(duration)}</span>
      ) : null}
      <span className="message-video-copy">
        <span className="message-video-title" title={fileName}>
          <span className="message-video-title-head">{displayFileName.head}</span>
          <span className="message-video-title-tail">{displayFileName.tail}</span>
        </span>
        <span className="message-video-meta">
          {uploading ? (size > 0 ? formatBytes(size) : "正在上传") : metaText}
        </span>
      </span>
      {uploading ? (
        <span className="message-video-upload">
          <em>
            {speed ? `${formatBytes(speed)}/s` : "正在连接"}
            {remainingSeconds ? ` · 剩余 ${formatDuration(remainingSeconds)}` : ""}
          </em>
        </span>
      ) : null}
    </button>
  );
}

function FileMessageRenderer({
  message,
  onDownload,
}: {
  message: ChatMessage;
  onDownload: () => void;
}) {
  const fileName = fileNameFromMessage(message, "文件");
  const size = sizeBytesFromMessage(message);
  const progress = numberPayload(message.contentJson?.progress);
  const uploadStatus = stringPayload(message.contentJson?.uploadStatus);
  const uploading =
    message.status === "sending" &&
    uploadStatus &&
    !["completed", "instant_completed"].includes(uploadStatus);
  const failed = message.status === "failed" || uploadStatus === "failed";
  return (
    <div className={`message-file-card ${failed ? "is-failed" : ""}`}>
      <div className="message-file-icon">
        <ChatIcon name="folder" />
      </div>
      <div className="message-file-main">
        <strong>{fileName}</strong>
        <span>
          {uploading
            ? `${uploadStatus === "hashing" ? "准备上传" : `上传中 ${progress ?? 0}%`}`
            : size > 0
              ? `${fileKindLabel(fileName)} · ${formatBytes(size)}`
              : fileKindLabel(fileName)}
        </span>
        {uploading ? (
          <i className="message-file-progress">
            <b style={{ width: `${Math.max(0, Math.min(100, progress ?? 0))}%` }} />
          </i>
        ) : null}
        {failed ? (
          <em className="message-file-error">
            {stringPayload(message.contentJson?.errorMessage) || "上传失败"}
          </em>
        ) : null}
      </div>
      <button type="button" onClick={onDownload}>
        下载
      </button>
    </div>
  );
}

function CallEventMessageRenderer({ message }: { message: ChatMessage }) {
  return <p>{message.content || "[通话]"}</p>;
}

function ContactCardMessageRenderer({
  message,
  onOpen,
}: {
  message: ChatMessage;
  onOpen: () => void;
}) {
  const payload = message.contentJson ?? {};
  const title =
    stringPayload(payload.nickname) ||
    stringPayload(payload.title) ||
    message.content ||
    "好友名片";
  const avatarUrl = stringPayload(payload.avatarUrl) || null;
  return (
    <button
      type="button"
      className="message-card-preview contact-card-preview"
      onClick={onOpen}
    >
      <span className="message-card-body">
        <Avatar label={title.slice(0, 1)} imageUrl={avatarUrl} tone="direct" />
        <span className="message-card-main">
          <strong>{title}</strong>
        </span>
      </span>
      <span className="message-card-label">推荐好友</span>
    </button>
  );
}

function GroupCardMessageRenderer({
  message,
  onOpen,
}: {
  message: ChatMessage;
  onOpen: () => void;
}) {
  const payload = message.contentJson ?? {};
  const title =
    stringPayload(payload.name) ||
    stringPayload(payload.title) ||
    message.content ||
    "群名片";
  const isInvite = message.kind === "group_share_card";
  const avatarUrl = stringPayload(payload.avatarUrl) || null;
  return (
    <button
      type="button"
      className={`message-card-preview group-card-preview ${
        isInvite ? "is-group-share" : ""
      }`}
      onClick={onOpen}
    >
      <span className="message-card-body">
        <Avatar label={title.slice(0, 1)} imageUrl={avatarUrl} tone="group" />
        <span className="message-card-main">
          <strong>{title}</strong>
        </span>
      </span>
      <span className="message-card-label">{isInvite ? "群邀请名片" : "群名片"}</span>
    </button>
  );
}

function ContactList({
  friends,
  groups,
  groupsById,
  requests,
  groupRequests,
  currentUserId,
  activeTab,
  activeUserId,
  activeGroupId,
  activeView,
  loading,
  error,
  onChangeTab,
  onOpenFriendRequests,
  onOpenGroupRequests,
  onSelectFriend,
  onSelectGroup,
  onFriendAvatarHover,
  onGroupAvatarHover,
  onAvatarLeave,
  onAddFriend,
  onAddGroup,
}: {
  friends: UserProfile[];
  groups: ChatConversation[];
  groupsById: Record<string, ChatGroup>;
  requests: FriendRequest[];
  groupRequests: ChatGroupJoinRequest[];
  currentUserId: number;
  activeTab: ContactListTab;
  activeUserId: number | null;
  activeGroupId: string | null;
  activeView: ContactDetailView;
  loading: boolean;
  error?: string | null;
  onChangeTab: (tab: ContactListTab) => void;
  onOpenFriendRequests: () => void;
  onOpenGroupRequests: () => void;
  onSelectFriend: (profile: UserProfile) => void;
  onSelectGroup: (conversation: ChatConversation) => void;
  onFriendAvatarHover: (profile: UserProfile, element: HTMLElement) => void;
  onGroupAvatarHover: (conversation: ChatConversation, element: HTMLElement) => void;
  onAvatarLeave: () => void;
  onAddFriend: () => void;
  onAddGroup: () => void;
}) {
  const pendingCount = requests.filter((request) =>
    isIncomingPendingRequest(request, currentUserId),
  ).length;
  const pendingGroupCount = groupRequests.filter((request) =>
    isPendingGroupRequest(request),
  ).length;

  return (
    <div className="chat-conversation-list contact-list">
      <button
        type="button"
        className={`contact-entry ${activeView === "friend-requests" ? "is-active" : ""}`}
        onClick={onOpenFriendRequests}
      >
        <span className="contact-entry-icon">
          <ChatIcon name="bell" />
        </span>
        <span className="contact-entry-main">
          <strong>好友通知</strong>
          <span>{pendingCount > 0 ? `${pendingCount} 条待处理` : "暂无待处理申请"}</span>
        </span>
        {pendingCount > 0 ? <i>{pendingCount > 99 ? "99+" : pendingCount}</i> : null}
      </button>
      <button
        type="button"
        className={`contact-entry ${activeView === "group-requests" ? "is-active" : ""}`}
        onClick={onOpenGroupRequests}
      >
        <span className="contact-entry-icon is-muted">
          <ChatIcon name="users" />
        </span>
        <span className="contact-entry-main">
          <strong>群通知</strong>
          <span>
            {pendingGroupCount > 0
              ? `${pendingGroupCount} 条待处理`
              : "暂无待处理群申请"}
          </span>
        </span>
        {pendingGroupCount > 0 ? (
          <i>{pendingGroupCount > 99 ? "99+" : pendingGroupCount}</i>
        ) : null}
      </button>

      <div className="contact-tabbar" role="tablist" aria-label="联系人类型">
        <button
          type="button"
          className={activeTab === "friends" ? "is-active" : ""}
          role="tab"
          aria-selected={activeTab === "friends"}
          onClick={() => onChangeTab("friends")}
        >
          好友
        </button>
        <button
          type="button"
          className={activeTab === "groups" ? "is-active" : ""}
          role="tab"
          aria-selected={activeTab === "groups"}
          onClick={() => onChangeTab("groups")}
        >
          群聊
        </button>
      </div>

      {loading && activeTab === "friends" && friends.length === 0 ? (
        <p className="contact-list-message">正在加载联系人...</p>
      ) : null}
      {error ? <p className="contact-list-message is-error">{error}</p> : null}
      {activeTab === "friends" ? (
        friends.length > 0 ? (
          friends.map((friend) => (
            <button
              key={friend.userId}
              type="button"
              className={`contact-friend-card ${
                activeUserId === friend.userId && activeView === "friend"
                  ? "is-active"
                  : ""
              }`}
              onClick={() => onSelectFriend(friend)}
            >
              <span
                className="avatar-hover-anchor"
                onMouseEnter={(event) => onFriendAvatarHover(friend, event.currentTarget)}
                onMouseLeave={onAvatarLeave}
              >
                <ProfileAvatarLite profile={friend} />
              </span>
              <span className={`presence-dot ${friend.online ? "online" : "offline"}`} />
              <span className="contact-entry-main">
                <strong>
                  {friend.nickname}
                  {friend.accountType === "class" ? <ClassBadge label="班" /> : null}
                </strong>
                <span>{friend.bio || "暂无简介"}</span>
              </span>
            </button>
          ))
        ) : loading ? null : (
          <section className="contact-empty-mini">
            <p>暂无好友</p>
            <button type="button" onClick={onAddFriend}>
              添加好友
            </button>
          </section>
        )
      ) : groups.length > 0 ? (
        groups.map((conversation) => {
          const groupId = conversation.groupId as string;
          const group = groupsById[groupId] ?? null;
          const memberCount =
            group?.memberCount ?? conversation.groupMemberCount ?? null;
          return (
            <button
              key={conversation.id}
              type="button"
              className={`contact-friend-card contact-group-card ${
                activeGroupId === groupId && activeView === "group"
                  ? "is-active"
                  : ""
              }`}
              onClick={() => onSelectGroup(conversation)}
            >
              <span
                className="avatar-hover-anchor"
                onMouseEnter={(event) => onGroupAvatarHover(conversation, event.currentTarget)}
                onMouseLeave={onAvatarLeave}
              >
                <Avatar
                  label={(group?.name || conversation.participant.avatar || "群").slice(0, 1)}
                  imageUrl={groupDisplayAvatarUrl(group, conversation)}
                  tone="group"
                />
              </span>
              <span className="contact-entry-main">
                <strong>
                  {group?.name || conversation.title}
                  {(group?.groupType ?? conversation.groupType) === "class" ? (
                    <ClassBadge label="班级群" />
                  ) : null}
                </strong>
                <span>
                  {memberCount ? `${memberCount} 人` : "群聊"}
                  {group?.description ? ` · ${group.description}` : ""}
                </span>
              </span>
            </button>
          );
        })
      ) : (
        <section className="contact-empty-mini">
          <p>暂无群聊</p>
          <button type="button" onClick={onAddGroup}>
            搜索或创建群
          </button>
        </section>
      )}
    </div>
  );
}

function ContactDetailPanel({
  view,
  profile,
  group,
  groupConversation,
  groupMembers,
  groupLoading,
  groupMembership,
  profiles,
  requests,
  groupRequests,
  currentUserId,
  loading,
  error,
  onAddFriend,
  onSendMessage,
  onOpenGroupConversation,
  onApplyGroup,
  onShareGroup,
  onAccept,
  onReject,
  onAcceptGroupRequest,
  onRejectGroupRequest,
}: {
  view: ContactDetailView;
  profile: UserProfile | null;
  group: ChatGroup | null;
  groupConversation: ChatConversation | null;
  groupMembers: ChatGroupMember[];
  groupLoading: boolean;
  groupMembership: GroupMembershipState;
  profiles: Record<number, UserProfile>;
  requests: FriendRequest[];
  groupRequests: ChatGroupJoinRequest[];
  currentUserId: number;
  loading: boolean;
  error?: string | null;
  onAddFriend: () => void;
  onSendMessage: (profile: UserProfile) => void;
  onOpenGroupConversation: (conversation: ChatConversation) => void;
  onApplyGroup: (groupId: string) => void;
  onShareGroup: (group: ChatGroup | null, conversation: ChatConversation) => void;
  onAccept: (request: FriendRequest) => void;
  onReject: (request: FriendRequest) => void;
  onAcceptGroupRequest: (request: ChatGroupJoinRequest) => void;
  onRejectGroupRequest: (request: ChatGroupJoinRequest) => void;
}) {
  if (view === "friend-requests") {
    return (
      <FriendRequestPanel
        requests={requests}
        currentUserId={currentUserId}
        loading={loading}
        error={error}
        onAccept={onAccept}
        onReject={onReject}
      />
    );
  }

  if (view === "group-requests") {
    return (
      <GroupRequestPanel
        requests={groupRequests}
        loading={loading}
        error={error}
        onAccept={onAcceptGroupRequest}
        onReject={onRejectGroupRequest}
      />
    );
  }

  if (view === "friend" && profile) {
    return (
      <FriendProfileView
        userId={profile.userId}
        initialProfile={profile}
        embedded
        onSendMessage={onSendMessage}
      />
    );
  }

  if (view === "group" && groupConversation) {
    return (
      <GroupContactProfileView
        group={group}
        conversation={groupConversation}
        members={groupMembers}
        loading={groupLoading}
        membership={groupMembership}
        profiles={profiles}
        onApply={() => onApplyGroup(group?.id || groupConversation.groupId || groupConversation.id)}
        onShare={() => onShareGroup(group, groupConversation)}
        onSendMessage={() => onOpenGroupConversation(groupConversation)}
      />
    );
  }

  return (
    <div className="chat-unselected-state">
      <div className="chat-empty-icon is-large">人</div>
      <h2>选择联系人查看资料</h2>
      <p>联系人为空时可以先搜索手机号或昵称添加好友</p>
      <div className="chat-empty-actions">
        <button type="button" onClick={onAddFriend}>
          添加好友
        </button>
      </div>
    </div>
  );
}

function FriendRequestPanel({
  requests,
  currentUserId,
  loading,
  error,
  onAccept,
  onReject,
}: {
  requests: FriendRequest[];
  currentUserId: number;
  loading: boolean;
  error?: string | null;
  onAccept: (request: FriendRequest) => void;
  onReject: (request: FriendRequest) => void;
}) {
  const incomingRequests = requests.filter((request) => {
    if (!Number.isInteger(currentUserId)) {
      return true;
    }
    return request.toUserId === currentUserId;
  });

  return (
    <div className="friend-notice-panel">
      <header>
        <h2>好友通知</h2>
        <p>处理好友验证申请</p>
      </header>
      {loading && incomingRequests.length === 0 ? (
        <p className="contact-list-message">正在加载好友通知...</p>
      ) : null}
      {error ? <p className="contact-list-message is-error">{error}</p> : null}
      <div className="friend-notice-list">
        {incomingRequests.length > 0 ? (
          incomingRequests.map((request) => {
            const profile = request.fromProfile;
            return (
              <article key={request.id} className="friend-notice-card">
                <ProfileAvatarLite profile={profile} />
                <div className="friend-notice-main">
                  <strong>{profile?.nickname || "用户"}</strong>
                  <p>{request.message || "请求添加你为好友"}</p>
                  <span>{formatRequestDate(request.createdAt)}</span>
                </div>
                <FriendRequestActions
                  request={request}
                  onAccept={onAccept}
                  onReject={onReject}
                />
              </article>
            );
          })
        ) : loading ? null : (
          <div className="chat-unselected-state">
            <div className="chat-empty-icon is-large">通</div>
            <h2>暂无好友通知</h2>
            <p>新的好友申请会显示在这里</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FriendRequestActions({
  request,
  onAccept,
  onReject,
}: {
  request: FriendRequest;
  onAccept: (request: FriendRequest) => void;
  onReject: (request: FriendRequest) => void;
}) {
  if (request.status === "accepted") {
    return <span className="friend-notice-status">已同意</span>;
  }
  if (request.status === "rejected") {
    return <span className="friend-notice-status">已拒绝</span>;
  }
  return (
    <div className="friend-notice-actions">
      <button type="button" onClick={() => onReject(request)}>
        拒绝
      </button>
      <button
        type="button"
        className="profile-primary-button"
        onClick={() => onAccept(request)}
      >
        同意
      </button>
    </div>
  );
}

function GroupRequestPanel({
  requests,
  loading,
  error,
  onAccept,
  onReject,
}: {
  requests: ChatGroupJoinRequest[];
  loading: boolean;
  error?: string | null;
  onAccept: (request: ChatGroupJoinRequest) => void;
  onReject: (request: ChatGroupJoinRequest) => void;
}) {
  const sortedRequests = [...requests].sort(compareGroupRequestsByTime);

  return (
    <div className="friend-notice-panel">
      <header>
        <h2>群通知</h2>
        <p>处理入群申请和查看邀请结果</p>
      </header>
      {loading && sortedRequests.length === 0 ? (
        <p className="contact-list-message">正在加载群通知...</p>
      ) : null}
      {error ? <p className="contact-list-message is-error">{error}</p> : null}
      <div className="friend-notice-list">
        {sortedRequests.length > 0 ? (
          sortedRequests.map((request) => {
            const applicant = request.applicantProfile;
            const inviter = request.inviterProfile;
            return (
              <article key={request.id} className="friend-notice-card group-notice-card">
                <div className="group-notice-avatar-stack">
                  <Avatar
                    label={(request.groupName || "群").slice(0, 1)}
                    imageUrl={request.groupAvatarUrl}
                    tone="group"
                  />
                  <ProfileAvatarLite profile={applicant} />
                </div>
                <div className="friend-notice-main">
                  <strong>{request.groupName || "群聊"}</strong>
                  <p>{groupRequestSummary(request)}</p>
                  {request.message ? <p className="group-notice-message">{request.message}</p> : null}
                  <span>
                    {formatRequestDate(request.createdAt)}
                    {inviter ? ` · 邀请人 ${inviter.nickname}` : ""}
                  </span>
                  {request.status !== "pending" ? (
                    <span>{groupRequestHandledText(request)}</span>
                  ) : null}
                </div>
                <GroupRequestActions
                  request={request}
                  onAccept={onAccept}
                  onReject={onReject}
                />
              </article>
            );
          })
        ) : loading ? null : (
          <div className="chat-unselected-state">
            <div className="chat-empty-icon is-large">群</div>
            <h2>暂无群通知</h2>
            <p>入群申请和群邀请处理结果会显示在这里</p>
          </div>
        )}
      </div>
    </div>
  );
}

function GroupRequestActions({
  request,
  onAccept,
  onReject,
}: {
  request: ChatGroupJoinRequest;
  onAccept: (request: ChatGroupJoinRequest) => void;
  onReject: (request: ChatGroupJoinRequest) => void;
}) {
  if (request.status === "accepted") {
    return <span className="friend-notice-status is-accepted">已同意</span>;
  }
  if (request.status === "rejected") {
    return <span className="friend-notice-status">已拒绝</span>;
  }
  if (!request.canHandle) {
    return <span className="friend-notice-status">待处理</span>;
  }
  return (
    <div className="friend-notice-actions">
      <button type="button" onClick={() => onReject(request)}>
        拒绝
      </button>
      <button
        type="button"
        className="profile-primary-button"
        onClick={() => onAccept(request)}
      >
        同意
      </button>
    </div>
  );
}

function GroupContactProfileView({
  group,
  conversation,
  members,
  loading,
  membership,
  profiles,
  onApply,
  onShare,
  onSendMessage,
}: {
  group: ChatGroup | null;
  conversation: ChatConversation;
  members: ChatGroupMember[];
  loading: boolean;
  membership: GroupMembershipState;
  profiles: Record<number, UserProfile>;
  onApply: () => void;
  onShare: () => void;
  onSendMessage: () => void;
}) {
  const groupName = group?.name || conversation.title || "群聊";
  const memberCount = group?.memberCount ?? conversation.groupMemberCount ?? members.length;
  const groupNo = formatGroupNo(group, conversation.groupId || conversation.id);
  const groupAvatarUrl = groupDisplayAvatarUrl(group, conversation);
  const groupDescription =
    group?.description?.trim() || conversation.subtitle?.trim() || "暂无群介绍";
  const visibleMembers = members.slice(0, 8);
  const groupJoined = membership === "joined";
  const groupPending = membership === "pending";
  const memberHint = loading
    ? "正在同步群资料..."
    : groupJoined
      ? members.length > 0
        ? ""
        : "正在同步群成员列表..."
      : groupPending
        ? "已提交入群申请，审核通过后可查看群成员"
        : "加入群聊后可查看群成员";

  return (
    <div className="group-contact-profile">
      <section className="group-contact-hero">
        <Avatar
          label={(groupName || "群").slice(0, 1)}
          imageUrl={groupAvatarUrl}
          tone="group"
        />
        <div className="group-contact-title">
          <h1>
            {groupName}
            {group?.groupType === "class" ? <ClassBadge label="班级群" /> : null}
          </h1>
          <p>群号 {groupNo}</p>
        </div>
      </section>

      <section className="group-contact-section">
        <h2>群介绍</h2>
        <p>{groupDescription}</p>
      </section>

      <section className="group-contact-section">
        <div className="group-contact-section-title">
          <h2>群成员</h2>
          <span>({memberCount || members.length || 0}人)</span>
        </div>
        {groupJoined && visibleMembers.length > 0 ? (
          <div className="group-contact-member-row">
            {visibleMembers.map((member) => {
              const profile =
                profiles[member.userId] ??
                ({
                  userId: member.userId,
                  nickname:
                    member.groupNickname || member.nickname || `用户${member.userId}`,
                  avatarUrl: member.avatarUrl ?? null,
                  avatarObjectKey: member.avatarObjectKey ?? null,
                  bio: "",
                  online: false,
                  friendStatus: "unknown",
                } as UserProfile);
              return <ProfileAvatarLite key={member.userId} profile={profile} />;
            })}
            {members.length > visibleMembers.length ? (
              <span className="group-contact-more">...</span>
            ) : null}
          </div>
        ) : (
          <p className="group-contact-muted">{memberHint}</p>
        )}
      </section>

      <div className="group-contact-actions">
        {groupJoined ? (
          <>
            <button type="button" className="profile-secondary-button" onClick={onShare}>
              分享
            </button>
            <button
              type="button"
              className="profile-primary-button"
              onClick={onSendMessage}
            >
              发消息
            </button>
          </>
        ) : groupPending ? (
          <button type="button" className="profile-secondary-button" disabled>
            等待审核
          </button>
        ) : (
          <button
            type="button"
            className="profile-primary-button"
            onClick={onApply}
          >
            申请加群
          </button>
        )}
      </div>
    </div>
  );
}

function ProfileAvatarLite({
  profile,
}: {
  profile: UserProfile | null | undefined;
}) {
  return (
    <span
      className={`profile-avatar is-small ${profile?.avatarUrl ? "has-image" : ""}`}
      style={
        profile?.avatarUrl
          ? { backgroundImage: `url(${profile.avatarUrl})` }
          : undefined
      }
    >
      {profile?.avatarUrl ? "" : profileInitial(profile)}
    </span>
  );
}

function ClassBadge({ label }: { label: string }) {
  return <i className="class-type-badge">{label}</i>;
}

function ConversationEmptyState({
  dataSource,
  accountState,
  onAddFriend,
}: {
  dataSource: ChatDataSourceState;
  accountState: LocalAccountState | null;
  onAddFriend: () => void;
}) {
  const copy = emptyConversationCopy(dataSource, accountState);
  return (
    <section className="conversation-empty-state">
      <div className="chat-empty-icon">+</div>
      <h2>{copy.title}</h2>
      <p>{copy.description}</p>
      <button type="button" onClick={onAddFriend}>
        添加好友
      </button>
    </section>
  );
}

function NoConversationSelected({
  dataSource,
  accountState,
  onAddFriend,
}: {
  dataSource: ChatDataSourceState;
  accountState: LocalAccountState | null;
  onAddFriend: () => void;
}) {
  const copy = emptyConversationCopy(dataSource, accountState);
  return (
    <div className="chat-unselected-state">
      <div className="chat-empty-icon is-large">+</div>
      <h2>{copy.mainTitle}</h2>
      <p>{copy.mainDescription}</p>
      <div className="chat-empty-actions">
        <button type="button" onClick={onAddFriend}>
          添加好友
        </button>
      </div>
    </div>
  );
}

function emptyConversationCopy(
  dataSource: ChatDataSourceState,
  accountState: LocalAccountState | null,
) {
  if (dataSource.loading) {
    return {
      title: "正在连接",
      description: "正在加载云端会话",
      mainTitle: "正在连接云端会话",
      mainDescription: "连接完成后会显示你的最近聊天",
    };
  }

  if (!accountState?.loggedIn) {
    return {
      title: "未登录",
      description: "登录后查看聊天和联系人",
      mainTitle: "登录后使用教师助手聊天",
      mainDescription: "聊天、对讲和远程管理功能会在登录后可用",
    };
  }

  if (dataSource.error) {
    return {
      title: "暂无会话",
      description: "云端连接异常，可稍后重试或先添加好友",
      mainTitle: "暂未选中会话",
      mainDescription: "当前没有可打开的会话，可先搜索手机号或昵称添加好友",
    };
  }

  return {
    title: "暂无会话",
    description: "搜索手机号或昵称添加好友",
    mainTitle: "选择一个联系人开始聊天",
    mainDescription: "新账号暂无聊天记录，添加好友后可发起单聊",
  };
}

function ChatTitleBar() {
  const runWindowAction = (action: "minimize" | "toggleMaximize" | "close") => {
    try {
      const currentWindow = getCurrentWindow();
      if (action === "minimize") {
        void currentWindow.minimize();
        return;
      }

      if (action === "toggleMaximize") {
        void currentWindow.toggleMaximize();
        return;
      }

      void currentWindow.close();
    } catch {}
  };

  return (
    <header className="chat-titlebar" data-tauri-drag-region>
      <div className="chat-titlebar-brand" data-tauri-drag-region>
        <span data-tauri-drag-region>教师助手</span>
        <strong data-tauri-drag-region>消息</strong>
      </div>
      <div className="chat-window-controls">
        <button
          type="button"
          title="最小化"
          onClick={() => runWindowAction("minimize")}
        >
          -
        </button>
        <button
          type="button"
          title="最大化"
          onClick={() => runWindowAction("toggleMaximize")}
        >
          □
        </button>
        <button
          type="button"
          title="关闭"
          className="close"
          onClick={() => runWindowAction("close")}
        >
          ×
        </button>
      </div>
    </header>
  );
}

function Avatar({
  label,
  imageUrl,
  tone,
}: {
  label: string;
  imageUrl?: string | null;
  tone: ChatConversation["kind"] | "self";
}) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  useEffect(() => {
    setFailedImageUrl(null);
  }, [imageUrl]);
  const displayImageUrl =
    imageUrl && failedImageUrl !== imageUrl ? imageUrl : null;
  return (
    <span
      className={`chat-avatar tone-${tone} ${displayImageUrl ? "has-image" : ""}`}
    >
      <span className="chat-avatar-label">{label}</span>
      {displayImageUrl ? (
        <img
          src={displayImageUrl}
          alt=""
          draggable={false}
          onError={() => setFailedImageUrl(displayImageUrl)}
        />
      ) : null}
    </span>
  );
}

function withProfile(
  conversation: ChatConversation,
  profiles: Record<number, UserProfile>,
): ChatConversation {
  const userId = Number(conversation.participant.id);
  const profile = Number.isInteger(userId) ? profiles[userId] : undefined;
  if (!profile) {
    return conversation;
  }
  return mergeProfileIntoConversation(conversation, profile);
}

function mergeProfileIntoConversation(
  conversation: ChatConversation,
  profile: UserProfile,
): ChatConversation {
  if (Number(conversation.participant.id) !== profile.userId) {
    return conversation;
  }
  const title = profile.nickname || conversation.title;
  const avatar = avatarLabel(profile, conversation.participant.avatar);
  const avatarUrl = profile.avatarUrl ?? null;
  const presence = profile.online ? "online" : conversation.participant.presence;
  const accountType = profile.accountType ?? conversation.participant.accountType ?? null;
  const classNo = profile.classNo ?? conversation.participant.classNo ?? null;
  if (
    conversation.title === title &&
    conversation.participant.name === title &&
    conversation.participant.avatar === avatar &&
    conversation.participant.avatarUrl === avatarUrl &&
    conversation.participant.presence === presence &&
    conversation.participant.accountType === accountType &&
    conversation.participant.classNo === classNo
  ) {
    return conversation;
  }
  return {
    ...conversation,
    title,
    participant: {
      ...conversation.participant,
      name: title,
      avatar,
      avatarUrl,
      accountType,
      classNo,
      presence,
      presenceLabel: profile.online ? "在线" : conversation.participant.presenceLabel,
    },
  };
}

function upsertConversation(
  conversations: ChatConversation[],
  conversation: ChatConversation,
): ChatConversation[] {
  const index = conversations.findIndex((item) => item.id === conversation.id);
  if (index < 0) {
    return [conversation, ...conversations];
  }
  const next = [...conversations];
  next[index] = {
    ...next[index],
    ...conversation,
    unreadCount: next[index].unreadCount,
  };
  return next;
}

function upsertProfile(
  profiles: UserProfile[],
  profile: UserProfile,
): UserProfile[] {
  const index = profiles.findIndex((item) => item.userId === profile.userId);
  if (index < 0) {
    return [...profiles, profile].sort((left, right) =>
      left.nickname.localeCompare(right.nickname, "zh-Hans-CN"),
    );
  }
  if (sameProfile(profiles[index], profile)) {
    return profiles;
  }
  const next = [...profiles];
  next[index] = profile;
  return next;
}

function updateProfileList(
  profiles: UserProfile[],
  profile: UserProfile,
  allowInsert: boolean,
): UserProfile[] {
  const index = profiles.findIndex((item) => item.userId === profile.userId);
  if (index < 0) {
    return allowInsert ? upsertProfile(profiles, profile) : profiles;
  }
  if (sameProfile(profiles[index], profile)) {
    return profiles;
  }
  const next = [...profiles];
  next[index] = { ...profiles[index], ...profile };
  return next;
}

function upsertFriendRequest(
  requests: FriendRequest[],
  request: FriendRequest,
): FriendRequest[] {
  const index = requests.findIndex((item) => item.id === request.id);
  if (index < 0) {
    return [request, ...requests];
  }
  const next = [...requests];
  next[index] = request;
  return next;
}

function upsertGroupRequest(
  requests: ChatGroupJoinRequest[],
  request: ChatGroupJoinRequest,
): ChatGroupJoinRequest[] {
  const index = requests.findIndex((item) => item.id === request.id);
  if (index < 0) {
    return [request, ...requests].sort(compareGroupRequestsByTime);
  }
  const next = [...requests];
  next[index] = request;
  return next.sort(compareGroupRequestsByTime);
}

function updateRequestProfiles(
  requests: FriendRequest[],
  profile: UserProfile,
): FriendRequest[] {
  let changed = false;
  const next = requests.map((request) => {
    let updated = request;
    if (request.fromProfile?.userId === profile.userId) {
      updated = { ...updated, fromProfile: profile };
    }
    if (request.toProfile?.userId === profile.userId) {
      updated = { ...updated, toProfile: profile };
    }
    if (updated !== request) {
      changed = true;
    }
    return updated;
  });
  return changed ? next : requests;
}

function updateGroupRequestProfiles(
  requests: ChatGroupJoinRequest[],
  profile: UserProfile,
): ChatGroupJoinRequest[] {
  let changed = false;
  const next = requests.map((request) => {
    let updated = request;
    if (request.applicantProfile?.userId === profile.userId) {
      updated = { ...updated, applicantProfile: profile };
    }
    if (request.inviterProfile?.userId === profile.userId) {
      updated = { ...updated, inviterProfile: profile };
    }
    if (request.handledByProfile?.userId === profile.userId) {
      updated = { ...updated, handledByProfile: profile };
    }
    if (updated !== request) {
      changed = true;
    }
    return updated;
  });
  return changed ? next : requests;
}

function mergeMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  current.forEach((message) => {
    map.set(message.id, message);
  });
  incoming.forEach((message) => {
    const existing = map.get(message.id);
    map.set(message.id, existing ? mergeMessagePreservingLocalMedia(existing, message) : message);
  });
  return Array.from(map.values()).sort(compareMessages);
}

function rememberLocalMediaPath(
  store: Record<string, string>,
  message: ChatMessage,
  path: string,
): void {
  const localPath = path.trim();
  if (!localPath) {
    return;
  }
  store[`message:${message.id}`] = localPath;
  const fileObjectId = message.fileObjectId || fileObjectIdFromMessage(message);
  if (fileObjectId) {
    store[`file:${fileObjectId}`] = localPath;
  }
  const uploadTaskId = message.contentJson?.uploadTaskId;
  if (typeof uploadTaskId === "string" && uploadTaskId.trim()) {
    store[`task:${uploadTaskId}`] = localPath;
  }
  mediaDebug("rememberLocalMediaPath", {
    messageId: message.id,
    fileObjectId: fileObjectId || null,
    path: localPath,
  });
}

function withRememberedLocalMediaPath(
  message: ChatMessage,
  store: Record<string, string>,
): ChatMessage {
  const content = message.contentJson ?? {};
  if (typeof content.localPath === "string" && content.localPath.trim()) {
    rememberLocalMediaPath(store, message, content.localPath);
    return message;
  }
  const fileObjectId = message.fileObjectId || fileObjectIdFromMessage(message);
  const uploadTaskId = content.uploadTaskId;
  const sameFileKey = fileObjectId
    ? Object.keys(store).find(
        (key) => key.startsWith("file:") && key.slice("file:".length) === fileObjectId,
      )
    : "";
  const remembered =
    store[`message:${message.id}`] ||
    (fileObjectId ? store[`file:${fileObjectId}`] : "") ||
    (typeof uploadTaskId === "string" ? store[`task:${uploadTaskId}`] : "") ||
    (sameFileKey ? store[sameFileKey] : "");
  if (!remembered) {
    return message;
  }
  mediaDebug("withRememberedLocalMediaPath restored", {
    messageId: message.id,
    fileObjectId: fileObjectId || null,
    path: remembered,
  });
  return {
    ...message,
    contentJson: {
      ...content,
      localPath: remembered,
    },
  };
}

function mergeMessagePreservingLocalMedia(
  existing: ChatMessage,
  incoming: ChatMessage,
): ChatMessage {
  const existingContent = existing.contentJson ?? {};
  const incomingContent = incoming.contentJson ?? {};
  const preserved: Record<string, unknown> = {};
  for (const key of [
    "localPath",
    "filePath",
    "downloadPath",
    "cachePath",
    "thumbnailLocalPath",
    "posterLocalPath",
    "thumbnailLocalUrl",
    "posterLocalUrl",
    "thumbnailUrl",
    "thumbUrl",
    "previewUrl",
    "posterUrl",
  ]) {
    const currentValue = existingContent[key];
    const nextValue = incomingContent[key];
    if (typeof currentValue === "string" && currentValue.trim() && !isHttpUrl(currentValue)) {
      const nextIsLocal = typeof nextValue === "string" && nextValue.trim() && !isHttpUrl(nextValue);
      if (!nextIsLocal) {
        preserved[key] = currentValue;
      }
    }
  }
  if (Object.keys(preserved).length === 0) {
    return incoming;
  }
  mediaDebug("mergeMessages preserved local media fields", {
    messageId: incoming.id,
    preservedKeys: Object.keys(preserved),
    fileObjectId: incoming.fileObjectId ?? incoming.contentJson?.fileObjectId ?? null,
  });
  return {
    ...incoming,
    contentJson: {
      ...incomingContent,
      ...preserved,
    },
  };
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function compareMessages(left: ChatMessage, right: ChatMessage): number {
  const leftSeq = left.conversationSeq ?? Number.MAX_SAFE_INTEGER;
  const rightSeq = right.conversationSeq ?? Number.MAX_SAFE_INTEGER;
  if (leftSeq !== rightSeq) {
    return leftSeq - rightSeq;
  }
  const leftTime = messageTimestamp(left);
  const rightTime = messageTimestamp(right);
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
}

function compareMediaViewerItems(left: MediaViewerItem, right: MediaViewerItem): number {
  const leftSeq = left.seq ?? Number.MAX_SAFE_INTEGER;
  const rightSeq = right.seq ?? Number.MAX_SAFE_INTEGER;
  if (leftSeq !== rightSeq) {
    return leftSeq - rightSeq;
  }
  const leftTime = left.sentAt ? new Date(left.sentAt).getTime() : Number.MAX_SAFE_INTEGER;
  const rightTime = right.sentAt ? new Date(right.sentAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
}

function shouldShowMessageTimeline(
  current: ChatMessage,
  previous?: ChatMessage,
): boolean {
  const currentTime = messageTimestamp(current);
  if (!currentTime) {
    return !previous;
  }
  if (!previous) {
    return true;
  }
  const previousTime = messageTimestamp(previous);
  if (!previousTime) {
    return true;
  }
  const currentDate = new Date(currentTime);
  const previousDate = new Date(previousTime);
  if (!isSameCalendarDay(currentDate, previousDate)) {
    return true;
  }
  return currentTime - previousTime >= CHAT_TIMELINE_GAP_MS;
}

function formatChatTimelineTime(message: ChatMessage): string {
  const timestamp = messageTimestamp(message);
  if (!timestamp) {
    return message.timeLabel ?? "";
  }
  const date = new Date(timestamp);
  const now = new Date();
  const time = formatHourMinute(date);
  if (isSameCalendarDay(date, now)) {
    return time;
  }
  const yesterday = startOfCalendarDay(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameCalendarDay(date, yesterday)) {
    return `昨天 ${time}`;
  }
  if (isSameCalendarWeek(date, now)) {
    return `${formatWeekday(date)} ${time}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${formatWeekday(date)} ${time}`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function formatFullChatTime(message: ChatMessage): string {
  const timestamp = messageTimestamp(message);
  if (!timestamp) {
    return message.timeLabel ?? "";
  }
  const date = new Date(timestamp);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${formatWeekday(
    date,
  )} ${formatHourMinute(date)}`;
}

function messageTimestamp(message: ChatMessage): number {
  const createdTime = Date.parse(message.createdAt ?? "");
  if (Number.isFinite(createdTime)) {
    return createdTime;
  }
  return messageTimestampFromTimeLabel(message.timeLabel);
}

function messageTimestampFromTimeLabel(timeLabel?: string): number {
  if (!timeLabel) {
    return 0;
  }
  const todayTime = /^(\d{1,2}):(\d{2})$/.exec(timeLabel.trim());
  if (todayTime) {
    const date = new Date();
    date.setHours(Number(todayTime[1]), Number(todayTime[2]), 0, 0);
    return date.getTime();
  }
  const yesterdayTime = /^昨天\s*(\d{1,2}):(\d{2})$/.exec(timeLabel.trim());
  if (yesterdayTime) {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    date.setHours(Number(yesterdayTime[1]), Number(yesterdayTime[2]), 0, 0);
    return date.getTime();
  }
  return 0;
}

function formatHourMinute(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function formatWeekday(date: Date): string {
  return ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][
    date.getDay()
  ];
}

function startOfCalendarDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isSameCalendarWeek(left: Date, right: Date): boolean {
  const leftMonday = startOfCalendarWeek(left);
  const rightMonday = startOfCalendarWeek(right);
  return leftMonday.getTime() === rightMonday.getTime();
}

function startOfCalendarWeek(date: Date): Date {
  const start = startOfCalendarDay(date);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  return start;
}

function revokedMessageText(message: ChatMessage): string {
  return message.direction === "outgoing"
    ? "你撤回了一条消息"
    : "对方撤回了一条消息";
}

function fileContentJson(file: UploadedChatFile): Record<string, unknown> {
  return {
    fileId: file.id,
    fileObjectId: file.id,
    fileName: file.originalName || "未命名文件",
    sizeBytes: file.sizeBytes,
    contentType: file.contentType || "application/octet-stream",
    fileType: file.fileType,
    duration: file.durationSeconds ?? null,
    durationSeconds: file.durationSeconds ?? null,
    width: file.width ?? null,
    height: file.height ?? null,
    sha256: file.sha256 ?? null,
    ext: file.ext ?? null,
    url: null,
  };
}

async function createVideoPosterSnapshot(
  filePath: string,
): Promise<VideoPosterSnapshot | null> {
  if (!filePath) {
    return null;
  }
  return withTimeout(createVideoPosterSnapshotInner(filePath), VIDEO_POSTER_TOTAL_TIMEOUT_MS);
}

async function createVideoPosterSnapshotInner(
  filePath: string,
): Promise<VideoPosterSnapshot | null> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.src = convertFileSrc(filePath);
  try {
    await waitForVideoMetadata(video);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const candidates = posterCandidateTimes(duration);
    let best: VideoPosterSnapshot | null = null;
    let bestScore = -1;
    for (const time of candidates) {
      const snapshot = await captureVideoPosterAt(video, time).catch(() => null);
      if (!snapshot) {
        continue;
      }
      const score = snapshot.score;
      if (score > bestScore) {
        best = snapshot;
        bestScore = score;
      }
      if (score >= VIDEO_POSTER_GOOD_SCORE) {
        return snapshot;
      }
    }
    return best;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);
    promise
      .then((value) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        resolve(null);
      });
  });
}

function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      finish(new Error("video metadata timeout"));
    }, VIDEO_POSTER_METADATA_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("error", handleError);
    };
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    const handleLoaded = () => {
      finish();
    };
    const handleError = () => {
      finish(new Error("video metadata unavailable"));
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      finish();
      return;
    }
    video.addEventListener("loadedmetadata", handleLoaded, { once: true });
    video.addEventListener("error", handleError, { once: true });
    video.load();
  });
}

function posterCandidateTimes(duration: number): number[] {
  const safeDuration = Math.max(0, duration);
  const values = [1, 0.5, 2, 3];
  if (safeDuration > 0) {
    values.push(safeDuration * 0.1);
    values.push(safeDuration * 0.25);
    values.push(Math.min(5, Math.max(0, safeDuration - 0.1)));
  }
  return Array.from(new Set(values.map((value) => {
    if (safeDuration <= 0) {
      return Math.max(0, value);
    }
    return clampNumber(value, 0, Math.max(0, safeDuration - 0.05));
  })));
}

function captureVideoPosterAt(
  video: HTMLVideoElement,
  time: number,
): Promise<VideoPosterSnapshot> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      finish(undefined, new Error("video poster seek timeout"));
    }, VIDEO_POSTER_SEEK_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
    };
    const finish = (snapshot?: VideoPosterSnapshot, error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      if (!snapshot) {
        reject(new Error("video poster capture failed"));
        return;
      }
      resolve(snapshot);
    };
    const handleError = () => {
      finish(undefined, new Error("video poster capture failed"));
    };
    const handleSeeked = () => {
      try {
        const width = video.videoWidth || 640;
        const height = video.videoHeight || 360;
        const canvas = document.createElement("canvas");
        const targetWidth = VIDEO_POSTER_TARGET_WIDTH;
        const targetHeight = Math.max(1, Math.round((height / width) * targetWidth));
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          finish(undefined, new Error("canvas unavailable"));
          return;
        }
        context.drawImage(video, 0, 0, targetWidth, targetHeight);
        const dataUrl = canvas.toDataURL("image/jpeg", VIDEO_POSTER_QUALITY);
        const bytes = dataUrlToBytes(dataUrl);
        const snapshot: VideoPosterSnapshot = {
          bytes,
          dataUrl,
          width: targetWidth,
          height: targetHeight,
          score: canvasBrightnessScore(context, targetWidth, targetHeight),
          timeSeconds: time,
        };
        void persistVideoPosterSnapshot(snapshot).then(finish);
      } catch (error) {
        finish(undefined, error);
      }
    };
    video.addEventListener("seeked", handleSeeked, { once: true });
    video.addEventListener("error", handleError, { once: true });
    if (Math.abs(video.currentTime - time) < 0.02 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      handleSeeked();
      return;
    }
    try {
      video.currentTime = time;
    } catch (error) {
      finish(undefined, error);
    }
  });
}

function canvasBrightnessScore(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): number {
  const sampleWidth = Math.min(96, width);
  const sampleHeight = Math.min(54, height);
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;
  const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!sampleContext) {
    return 0;
  }
  sampleContext.drawImage(context.canvas, 0, 0, sampleWidth, sampleHeight);
  const imageData = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
  let luminanceTotal = 0;
  let edgeTotal = 0;
  let coloredPixels = 0;
  let previousLuminance = 0;
  for (let index = 0; index < imageData.length; index += 4) {
    const red = imageData[index];
    const green = imageData[index + 1];
    const blue = imageData[index + 2];
    const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
    luminanceTotal += luminance;
    if (index > 0) {
      edgeTotal += Math.abs(luminance - previousLuminance);
    }
    previousLuminance = luminance;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 12) {
      coloredPixels += 1;
    }
  }
  const pixels = imageData.length / 4;
  const averageLuminance = luminanceTotal / pixels;
  const edgeScore = edgeTotal / Math.max(1, pixels - 1);
  const colorScore = (coloredPixels / pixels) * 20;
  return averageLuminance + edgeScore * 0.45 + colorScore;
}

function dataUrlToBytes(dataUrl: string): number[] {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Array<number>(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function persistVideoPosterSnapshot(
  snapshot: VideoPosterSnapshot,
): Promise<VideoPosterSnapshot> {
  try {
    const saved = await saveChatVideoPoster({
      key: `${Date.now()}_${snapshot.bytes.length}_${Math.round(snapshot.timeSeconds * 1000)}`,
      bytes: snapshot.bytes,
    });
    return {
      ...snapshot,
      localPath: saved.path,
      localUrl: saved.url,
    };
  } catch {
    return snapshot;
  }
}

function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.\\/]+$/, "") || "video";
}

function splitCompactVideoFileName(fileName: string): { head: string; tail: string } {
  const normalized = fileName.replace(/\s+/g, " ").trim();
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === normalized.length - 1) {
    return { head: normalized, tail: "" };
  }
  const stem = normalized.slice(0, dotIndex);
  const extension = normalized.slice(dotIndex);
  const tailStem = stem.slice(-2);
  const headStem = stem.slice(0, Math.max(0, stem.length - tailStem.length));
  return {
    head: headStem,
    tail: `${tailStem}${extension}`,
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
  if (
    contentType.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|bmp)$/i.test(lower)
  ) {
    return "image";
  }
  if (
    contentType.startsWith("video/") ||
    /\.(mp4|mov|webm|avi|mkv)$/i.test(lower)
  ) {
    return "video";
  }
  return fallback;
}

function uploadMessageContent(kind: "image" | "video" | "file", fileName: string): string {
  if (kind === "image") {
    return "[图片]";
  }
  if (kind === "video") {
    return `[视频] ${fileName}`;
  }
  return `[文件] ${fileName}`;
}

function canManageGroupDrive(group: ChatGroup | null | undefined): boolean {
  return group?.currentUserRole === "owner" || group?.currentUserRole === "admin";
}

function isMessageFileDefinitelyUnavailable(message: ChatMessage): boolean {
  const status = chatFileAccessStatus(message);
  return status === "expired" || status === "revoked" || status === "blocked" || status === "deleted";
}

function formatDuration(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${rest
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function fileKindLabel(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (/\.(doc|docx)$/i.test(lower)) return "Word 文档";
  if (/\.(xls|xlsx)$/i.test(lower)) return "表格";
  if (/\.(ppt|pptx)$/i.test(lower)) return "演示文稿";
  if (/\.pdf$/i.test(lower)) return "PDF";
  if (/\.(zip|rar|7z|tar|gz)$/i.test(lower)) return "压缩包";
  if (/\.(mp4|mov|webm|avi|mkv)$/i.test(lower)) return "视频";
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(lower)) return "图片";
  return "文件";
}

function transferStatusLabel(status: string): string {
  if (status === "waiting") return "等待中";
  if (status === "hashing") return "准备中";
  if (status === "uploading") return "上传中";
  if (status === "downloading") return "下载中";
  if (status === "paused") return "已暂停";
  if (status === "failed") return "失败";
  if (status === "completed") return "已完成";
  if (status === "instant_completed") return "秒传完成";
  if (status === "canceled") return "已取消";
  return status;
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
    if (sortMode === "name") {
      return left.name.localeCompare(right.name, "zh-Hans-CN");
    }
    if (sortMode === "size") {
      return (right.file?.sizeBytes ?? 0) - (left.file?.sizeBytes ?? 0);
    }
    if (sortMode === "type") {
      return fileKindLabel(left.name).localeCompare(fileKindLabel(right.name), "zh-Hans-CN");
    }
    return dateValue(right.updatedAt || right.createdAt) - dateValue(left.updatedAt || left.createdAt);
  });
}

function filterDriveNodes(nodes: DriveNode[], filter: DriveFilter): DriveNode[] {
  if (filter === "all") {
    return nodes;
  }
  return nodes.filter((node) => {
    if (node.type === "folder") {
      return true;
    }
    const tone = driveNodeFileTone(node);
    if (filter === "image") return tone === "image";
    if (filter === "video") return tone === "video";
    if (filter === "archive") return tone === "archive";
    if (filter === "document") return tone === "document";
    if (filter === "other") {
      return !["image", "video", "archive", "document"].includes(tone);
    }
    return true;
  });
}

function dateValue(value?: string | null): number {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatDriveDate(value?: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${date
    .getHours()
    .toString()
    .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function driveNodeFileTone(node: DriveNode): string {
  const type = node.file?.fileType || detectKindFromName(node.name, node.file?.contentType || "");
  if (type === "image") return "image";
  if (type === "video") return "video";
  if (fileKindLabel(node.name) === "压缩包") return "archive";
  if (["Word 文档", "表格", "演示文稿", "PDF"].includes(fileKindLabel(node.name))) return "document";
  return "file";
}

function isDriveMediaNode(node: DriveNode): boolean {
  if (node.type !== "file" || !node.fileObjectId) {
    return false;
  }
  const tone = driveNodeFileTone(node);
  return tone === "image" || tone === "video";
}

function driveNodeShortLabel(node: DriveNode): string {
  const tone = driveNodeFileTone(node);
  if (tone === "video") return "V";
  if (tone === "image") return "I";
  if (tone === "archive") return "Z";
  if (tone === "document") return "D";
  return "F";
}

function buildDefaultGroupName(friends: UserProfile[]): string {
  return friends
    .slice(0, 4)
    .map((friend) => friend.nickname.trim())
    .filter(Boolean)
    .join("、")
    .slice(0, 80);
}

function shortMemberName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 2) {
    return trimmed;
  }
  return `${trimmed.slice(0, 2)}...`;
}

function canManageAnyGroupMembers(role?: string | null): boolean {
  return role === "owner" || role === "admin";
}

function canRemoveGroupMember(
  currentRole: string,
  member: ChatGroupMember,
  currentUserId: number,
): boolean {
  if (member.userId === currentUserId || member.role === "owner") {
    return false;
  }
  if (currentRole === "owner") {
    return member.role === "member" || member.role === "admin";
  }
  if (currentRole === "admin") {
    return member.role === "member";
  }
  return false;
}

async function renderGroupSharePosterPng(
  group: GroupProfileSnapshot,
  invite: ChatGroupInvite,
  qrDataUrl: string,
): Promise<Uint8Array> {
  const scale = 2;
  const width = 900;
  const height = 1400;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("无法创建图片画布");
  }
  context.scale(scale, scale);
  context.fillStyle = "#f4f7fb";
  context.fillRect(0, 0, width, height);

  const cardX = 90;
  const cardY = 120;
  const cardW = width - cardX * 2;
  const cardH = 1160;
  context.shadowColor = "rgba(15, 23, 42, 0.12)";
  context.shadowBlur = 38;
  context.shadowOffsetY = 18;
  drawRoundRect(context, cardX, cardY, cardW, cardH, 36, "#ffffff");
  context.shadowColor = "transparent";

  const groupName = invite.group.name || group.name || "群聊";
  const avatarUrl = invite.group.avatarUrl || group.avatarUrl || "";
  if (avatarUrl) {
    try {
      const avatar = await loadCanvasImage(avatarUrl);
      drawRoundImage(context, avatar, 160, 180, 96, 48);
    } catch {
      drawPosterAvatarFallback(context, groupName, 160, 180, 96);
    }
  } else {
    drawPosterAvatarFallback(context, groupName, 160, 180, 96);
  }

  context.fillStyle = "#111827";
  context.font = "700 38px Microsoft YaHei, system-ui, sans-serif";
  drawPosterText(context, groupName, 280, 215, 430);
  context.fillStyle = "#6b7280";
  context.font = "500 24px Microsoft YaHei, system-ui, sans-serif";
  context.fillText(`群号：${formatGroupNo(invite.group ?? group)}`, 280, 257);
  context.strokeStyle = "#edf1f6";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(150, 330);
  context.lineTo(750, 330);
  context.stroke();

  const qr = await loadCanvasImage(qrDataUrl);
  context.drawImage(qr, 210, 420, 480, 480);
  context.fillStyle = "#111827";
  context.font = "700 28px Microsoft YaHei, system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText("扫一扫二维码，加入群聊", width / 2, 985);
  context.fillStyle = "#6b7280";
  context.font = "800 34px Microsoft YaHei, system-ui, sans-serif";
  context.fillText("♟  QQ", width / 2, 1147);
  context.textAlign = "start";

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) {
        resolve(value);
      } else {
        reject(new Error("图片生成失败"));
      }
    }, "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function groupSharePosterFileName(groupName: string, groupId: string): string {
  const safeGroupName = (groupName || "群聊").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  const safeGroupId = (groupId || "group").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return `群聊邀请_${safeGroupName}_${safeGroupId}.png`;
}

function loadCanvasImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = src;
  });
}

function drawRoundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillStyle: string,
) {
  context.fillStyle = fillStyle;
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
  context.fill();
}

function drawRoundImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  size: number,
  radius: number,
) {
  context.save();
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + size - radius, y);
  context.quadraticCurveTo(x + size, y, x + size, y + radius);
  context.lineTo(x + size, y + size - radius);
  context.quadraticCurveTo(x + size, y + size, x + size - radius, y + size);
  context.lineTo(x + radius, y + size);
  context.quadraticCurveTo(x, y + size, x, y + size - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
  context.clip();
  context.drawImage(image, x, y, size, size);
  context.restore();
}

function drawPosterAvatarFallback(
  context: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  size: number,
) {
  drawRoundRect(context, x, y, size, size, size / 2, "#1677ff");
  context.fillStyle = "#ffffff";
  context.font = "800 38px Microsoft YaHei, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label.slice(0, 1) || "群", x + size / 2, y + size / 2 + 1);
  context.textAlign = "start";
  context.textBaseline = "alphabetic";
}

function drawPosterText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  let text = value;
  while (context.measureText(text).width > maxWidth && text.length > 1) {
    text = `${text.slice(0, -2)}…`;
  }
  context.fillText(text, x, y);
}

function friendlyError(error: string): string {
  if (
    error.includes("413") ||
    error.includes("Request Entity Too Large") ||
    error.includes("Chunk too large")
  ) {
    return "文件分片超过服务器上传限制，请更新后端网关配置后重试";
  }
  if (
    error.includes("Internal Server Error") ||
    error.includes("File storage service is temporarily unavailable") ||
    error.includes("Failed to merge uploaded file") ||
    error.includes("Failed to save uploaded file")
  ) {
    return "文件上传完成处理失败，请稍后重试；如果持续失败，请检查后端存储服务";
  }
  if (error.includes("Select at least one friend")) {
    return "请至少选择 1 位好友";
  }
  if (error.includes("Only friends can be added to a group")) {
    return "只能邀请好友创建群聊";
  }
  if (error.includes("Group member limit exceeded")) {
    return "群成员上限为 500 人";
  }
  if (error.includes("Not authenticated")) {
    return "登录状态已失效，请重新登录";
  }
  return error;
}

async function fileToBytes(file: File): Promise<number[]> {
  const buffer = await file.arrayBuffer();
  return Array.from(new Uint8Array(buffer));
}

function isIncomingPendingRequest(
  request: FriendRequest,
  currentUserId: number,
): boolean {
  return (
    request.status === "pending" &&
    Number.isInteger(currentUserId) &&
    request.toUserId === currentUserId
  );
}

function isPendingGroupRequest(request: ChatGroupJoinRequest): boolean {
  return request.status === "pending";
}

function compareGroupRequestsByTime(
  left: ChatGroupJoinRequest,
  right: ChatGroupJoinRequest,
): number {
  const leftTime = Date.parse(left.createdAt ?? "") || 0;
  const rightTime = Date.parse(right.createdAt ?? "") || 0;
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return right.id - left.id;
}

function groupRequestSummary(request: ChatGroupJoinRequest): string {
  const applicantName = request.applicantProfile?.nickname || `用户${request.applicantUserId}`;
  const inviterName = request.inviterProfile?.nickname;
  if (inviterName) {
    return `${inviterName} 邀请 ${applicantName} 加入群聊`;
  }
  return `${applicantName} 申请加入群聊`;
}

function groupRequestHandledText(request: ChatGroupJoinRequest): string {
  const handler = request.handledByProfile?.nickname;
  if (request.status === "accepted") {
    return handler ? `已由 ${handler} 同意` : "已同意";
  }
  if (request.status === "rejected") {
    return handler ? `已由 ${handler} 拒绝` : "已拒绝";
  }
  return "待处理";
}

function formatRequestDate(value?: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function avatarCacheKey(profile: UserProfile): string {
  return profile.avatarObjectKey || profile.avatarUrl || `user:${profile.userId}`;
}

function groupAvatarCacheKey(
  group: Pick<
    ChatGroup,
    "id" | "avatarUrl" | "avatarObjectKey" | "updatedAt"
  >,
): string {
  return `group:${group.id}:${
    group.avatarObjectKey || stableAvatarReference(group.avatarUrl) || "avatar"
  }`;
}

function formatGroupNo(
  group: Pick<ChatGroup, "id" | "groupNo"> | GroupProfileSnapshot | null | undefined,
  fallbackId?: string | null,
): string {
  const direct = normalizeGroupNo(group?.groupNo);
  if (direct) {
    return direct;
  }
  const rawId = group?.id || fallbackId || "";
  const numericId = normalizeGroupNo(rawId);
  if (numericId) {
    return numericId;
  }
  return stableNumericGroupNo(rawId || "group");
}

function normalizeGroupNo(value?: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  if (/^\d{5,12}$/.test(trimmed)) {
    return trimmed;
  }
  const digits = trimmed.match(/\d+/g)?.join("") ?? "";
  return /^\d{5,12}$/.test(digits) ? digits : null;
}

function stableNumericGroupNo(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return String(100000000 + ((hash >>> 0) % 900000000));
}

function stableAvatarReference(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.split("?")[0] || trimmed;
}

function groupDisplayAvatarUrl(
  group: Pick<ChatGroup, "avatarUrl"> | null | undefined,
  conversation:
    | Pick<ChatConversation, "groupAvatarUrl" | "participant">
    | null
    | undefined,
): string | null {
  const groupAvatarUrl = group?.avatarUrl ?? null;
  const conversationGroupAvatarUrl = conversation?.groupAvatarUrl ?? null;
  const participantAvatarUrl = conversation?.participant.avatarUrl ?? null;
  if (groupAvatarUrl && isLocalAvatarUrl(groupAvatarUrl)) {
    return groupAvatarUrl;
  }
  if (conversationGroupAvatarUrl && isLocalAvatarUrl(conversationGroupAvatarUrl)) {
    return conversationGroupAvatarUrl;
  }
  if (participantAvatarUrl && isLocalAvatarUrl(participantAvatarUrl)) {
    return participantAvatarUrl;
  }
  return conversationGroupAvatarUrl || participantAvatarUrl || groupAvatarUrl || null;
}

function isLocalAvatarUrl(value: string): boolean {
  return (
    value.startsWith("asset:") ||
    value.startsWith("asset://") ||
    value.startsWith("file:") ||
    value.includes("asset.localhost") ||
    /^[a-zA-Z]:[\\/]/.test(value)
  );
}

function stringPayload(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function localMediaUrlPayload(value: unknown): string {
  const text = stringPayload(value);
  if (
    text.startsWith("asset:") ||
    text.startsWith("data:") ||
    text.startsWith("blob:") ||
    text.startsWith("file:") ||
    text.includes("asset.localhost") ||
    /^[A-Za-z]:[\\/]/.test(text)
  ) {
    return /^[A-Za-z]:[\\/]/.test(text) ? convertFileSrc(text) : text;
  }
  return "";
}

function numberPayload(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function avatarLabel(profile: UserProfile | null | undefined, fallback: string): string {
  if (!profile) {
    return fallback;
  }
  return profileInitial(profile);
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

function sameGroup(
  left: ChatGroup | null | undefined,
  right: ChatGroup | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.id === right.id &&
    (left.groupNo || "") === (right.groupNo || "") &&
    left.conversationId === right.conversationId &&
    left.name === right.name &&
    (left.avatarUrl || "") === (right.avatarUrl || "") &&
    (left.avatarObjectKey || "") === (right.avatarObjectKey || "") &&
    (left.description || "") === (right.description || "") &&
    (left.announcement || "") === (right.announcement || "") &&
    left.ownerUserId === right.ownerUserId &&
    left.memberLimit === right.memberLimit &&
    left.memberCount === right.memberCount &&
    left.joinPolicy === right.joinPolicy &&
    left.status === right.status &&
    left.currentUserRole === right.currentUserRole &&
    (left.updatedAt || "") === (right.updatedAt || "")
  );
}
