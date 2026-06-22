import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CSSProperties, MouseEvent, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  archiveConversation,
  cacheChatFile,
  acceptChatGroupJoinRequest,
  clearConversationHistory,
  createDirectConversation,
  createChatGroup,
  deleteChatMessageForMe,
  dissolveChatGroup,
  downloadChatFile,
  inviteChatGroupMembers,
  leaveChatGroup,
  loadChatConversations,
  loadChatGroup,
  loadChatHistoryMessages,
  loadChatMessages,
  listenForDeletedChatMessages,
  listenForFriendRequestEvents,
  listenForGroupEvents,
  listenForNewChatMessages,
  listenForRevokedChatMessages,
  loadChatGroupNotifications,
  listChatGroupMembers,
  markConversationRead,
  postChatMessage,
  postTypedChatMessage,
  rejectChatGroupJoinRequest,
  removeChatGroupMember,
  revokeChatMessage,
  setChatGroupAdmin,
  setConversationMuted,
  setConversationPinned,
  startChatRealtime,
  stopChatRealtime,
  transferChatGroupOwner,
  unsetChatGroupAdmin,
  updateChatGroup,
  updateMyChatGroupMember,
  uploadChatFileBytes,
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
  fileUrlFromMessage,
  formatBytes,
  imagePreviewItemFromMessage,
  messagePreview,
  quoteFromMessage,
  sizeBytesFromMessage,
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
  ChatGroupJoinRequest,
  ChatGroupMember,
  ChatMessage,
  ChatMessageKind,
  ChatSticker,
  ConversationContextMenu,
  ImagePreviewItem,
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
import SmileIcon from "../../../images/smile.svg";
import UsersRoundIcon from "../../../images/users-round.svg";

type ChatSection = "messages" | "contacts";
type ContactDetailView = "empty" | "friend" | "friend-requests" | "group-requests";
type MessageContextMenu = {
  messageId: string;
  x: number;
  y: number;
} | null;
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
  | "clear-history";
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
type QuotedMessage = {
  id: string;
  senderLabel: string;
  preview: string;
};
type ForwardPickerState = {
  messageIds: string[];
} | null;
type EmojiPanelTab = "emoji" | "stickers";

const STICKER_ACCEPT = "image/png,image/gif,image/webp";
const GROUP_NICKNAME_MAX_LENGTH = 30;
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
  smile: SmileIcon,
  users: UsersRoundIcon,
} as const;

type ChatIconName = keyof typeof chatIconMap;

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
  const [rtcTestOpen, setRtcTestOpen] = useState(false);
  const [emojiPanelOpen, setEmojiPanelOpen] = useState(false);
  const [emojiPanelTab, setEmojiPanelTab] = useState<EmojiPanelTab>("emoji");
  const [stickers, setStickers] = useState<ChatSticker[]>([]);
  const [stickerUploading, setStickerUploading] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
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
  const [contactDetailView, setContactDetailView] =
    useState<ContactDetailView>("empty");
  const currentUserId = Number(accountState?.user?.cloudUserId);
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const emojiPanelRef = useRef<HTMLElement | null>(null);
  const groupSettingsToggleRef = useRef<HTMLButtonElement | null>(null);
  const groupSettingsDrawerRef = useRef<HTMLElement | null>(null);
  const chatListPanelRef = useRef<HTMLElement | null>(null);
  const chatMainPanelRef = useRef<HTMLElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stickerInputRef = useRef<HTMLInputElement | null>(null);
  const groupAvatarInputRef = useRef<HTMLInputElement | null>(null);
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
  const contactDetailViewRef = useRef<ContactDetailView>(contactDetailView);
  const currentUserIdRef = useRef<number | null>(null);
  const myProfileRef = useRef<UserProfile | null>(null);
  const profileMapRef = useRef<Record<number, UserProfile>>({});
  const avatarUrlMapRef = useRef<Record<string, string>>({});
  const stickersRef = useRef(stickers);
  const groupMapRef = useRef(groupMap);
  const groupMembersMapRef = useRef(groupMembersMap);

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
    groupMapRef.current = groupMap;
  }, [groupMap]);

  useEffect(() => {
    groupMembersMapRef.current = groupMembersMap;
  }, [groupMembersMap]);

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
    if (!groupSettingsOpen) {
      return;
    }
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        groupSettingsDrawerRef.current?.contains(target) ||
        groupSettingsToggleRef.current?.contains(target)
      ) {
        return;
      }
      if (
        chatListPanelRef.current?.contains(target) ||
        chatMainPanelRef.current?.contains(target)
      ) {
        setGroupSettingsOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
    };
  }, [groupSettingsOpen]);

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
        contactDetailView: contactDetailViewRef.current,
      },
    });
  };

  const applyAccountCache = (accountKey: string): boolean => {
    const cache = loadChatAccountCache(accountKey);
    if (!cache) {
      return false;
    }
    setConversations(cache.conversations);
    setMessages(cache.messages);
    setFriends(cache.friends);
    setFriendRequests(cache.friendRequests);
    setGroupMap(cache.groups ?? {});
    setGroupMembersMap(cache.groupMembers ?? {});
    setGroupRequests(cache.groupRequests ?? []);
    setMyProfile(cache.myProfile);
    setProfileMap(cache.profiles);
    setAvatarUrlMap(cache.avatarUrls ?? {});
    setStickers(cache.stickers ?? []);
    setActiveSection(cache.ui.activeSection);
    setActiveConversationId(
      cache.conversations.some(
        (conversation) => conversation.id === cache.ui.activeConversationId,
      )
        ? cache.ui.activeConversationId
        : cache.conversations[0]?.id ?? "",
    );
    setActiveContactUserId(
      cache.friends.some((friend) => friend.userId === cache.ui.activeContactUserId)
        ? cache.ui.activeContactUserId
        : null,
    );
    setContactDetailView(cache.ui.contactDetailView);
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

  const resetContacts = () => {
    contactsRefreshSeqRef.current += 1;
    setFriends([]);
    setFriendRequests([]);
    setContactsLoading(false);
    setContactsError(null);
    setActiveContactUserId(null);
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
    setConversations(remoteConversations);
    setActiveConversationId((current) =>
      remoteConversations.some((item) => item.id === current)
        ? current
        : remoteConversations[0]?.id ?? "",
    );
    if (clearMessages) {
      setMessages([]);
    }
    setDataSource({ loading: false, live: true, error: null });
    void refreshConversationProfiles(remoteConversations, refreshId);
    return remoteConversations;
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
      }>(FRIEND_REQUEST_SENT_EVENT, (event) => {
        if (disposed) {
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
        setQuotedMessage({
          id: event.payload.messageId,
          senderLabel: event.payload.senderLabel || "对方",
          preview: event.payload.preview || "聊天记录",
        });
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
            return mergeMessages(current, [normalizedMessage]);
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
              setGroupMap((current) => ({
                ...current,
                [groupEvent.group!.id]: groupEvent.group as ChatGroup,
              }));
            }
            if (groupEvent.conversation) {
              setConversations((current) =>
                upsertConversation(current, groupEvent.conversation as ChatConversation),
              );
              if (
                groupEvent.conversation.id === activeConversationIdRef.current &&
                groupEvent.conversation.kind === "group"
              ) {
                void refreshActiveGroupMembers(groupEvent.conversation).catch(
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
          setMessages((current) => mergeMessages(current, remoteMessages));
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
    setConversationMenu(null);
    setMessageMenu(null);
    setGroupMemberMenu(null);
  };

  const switchSection = (section: ChatSection) => {
    setActiveSection(section);
    closeContextMenus();
    if (section === "contacts" && accountState?.loggedIn) {
      void refreshContacts({ silent: friendsRef.current.length > 0 }).catch(
        () => undefined,
      );
    }
  };

  const selectConversation = (conversationId: string) => {
    setActiveSection("messages");
    setActiveConversationId(conversationId);
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
    setConversationMenu({
      conversationId,
      x: event.clientX,
      y: event.clientY,
    });
    setMoreMenuOpen(false);
    setAddMenuOpen(false);
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
    setMessageMenu({
      messageId: message.id,
      x: event.clientX,
      y: event.clientY,
    });
    setMoreMenuOpen(false);
    setAddMenuOpen(false);
    setConversationMenu(null);
  };

  const openGroupMemberMenu = (
    event: MouseEvent<HTMLElement>,
    groupId: string,
    memberUserId: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setGroupMemberMenu({
      groupId,
      memberUserId,
      x: event.clientX,
      y: event.clientY,
    });
    setMoreMenuOpen(false);
    setAddMenuOpen(false);
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
    if (!displayedActiveConversation || !activeGroupId) {
      return;
    }
    confirmGroupAction({
      action: "clear-history",
      groupId: activeGroupId,
      conversationId: displayedActiveConversation.id,
      title: "删除聊天记录",
      description: "将删除你在当前设备和云端可见的该会话历史记录，不会影响其他群成员，也不会退出群聊。",
      confirmText: "删除",
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

  const openRtcTestPanel = () => {
    setMoreMenuOpen(false);
    setAddMenuOpen(false);
    setConversationMenu(null);
    setMessageMenu(null);
    setGroupMemberMenu(null);
    setGroupSettingsOpen(false);
    setRtcTestOpen(true);
  };

  const openCreateGroupDialog = () => {
    setAddMenuOpen(false);
    setMoreMenuOpen(false);
    setConversationMenu(null);
    setMessageMenu(null);
    setCreateGroupError(null);
    setCreateGroupSearch("");
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
      setGroupMap((current) => ({
        ...current,
        [conversation.groupId as string]: groupResponse.group,
      }));
      setGroupMembersMap((current) => ({
        ...current,
        [conversation.groupId as string]: members,
      }));
      setConversations((current) =>
        upsertConversation(current, groupResponse.conversation),
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
      avatarUrl:
        group?.avatarUrl ||
        displayedActiveConversation?.participant.avatarUrl ||
        null,
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
      setGroupMap((current) => ({ ...current, [group.id]: group }));
      setConversations((current) => upsertConversation(current, conversation));
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
      setGroupMap((current) => ({ ...current, [group.id]: group }));
      setConversations((current) => upsertConversation(current, conversation));
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
    try {
      setCreatingGroup(true);
      setCreateGroupError(null);
      const { conversation } = await createChatGroup({
        name: createGroupName.trim() || null,
        memberUserIds: selectedGroupMemberIds,
      });
      setConversations((current) => upsertConversation(current, conversation));
      setActiveSection("messages");
      setActiveConversationId(conversation.id);
      setCreateGroupOpen(false);
      setCreateGroupSearch("");
      setCreateGroupName("");
      setSelectedGroupMemberIds([]);
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

  const selectFriendContact = (profile: UserProfile) => {
    setActiveSection("contacts");
    setActiveContactUserId(profile.userId);
    setContactDetailView("friend");
    closeContextMenus();
  };

  const openFriendRequests = () => {
    setActiveSection("contacts");
    setActiveContactUserId(null);
    setContactDetailView("friend-requests");
    if (accountState?.loggedIn) {
      void refreshContacts({ silent: true }).catch(() => undefined);
    }
    closeContextMenus();
  };

  const openGroupRequests = () => {
    setActiveSection("contacts");
    setActiveContactUserId(null);
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
      eventName === "group.join_request.handled" &&
      displayRequest.status === "accepted"
    ) {
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
      fileObjectId: fileObjectId ?? null,
      timeLabel,
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
    const contentJson = quote
      ? {
          quote: {
            messageId: quote.id,
            senderLabel: quote.senderLabel,
            preview: quote.preview,
          },
        }
      : null;
    const message = createLocalMessage("text", content, contentJson);
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

  const sendAttachmentMessage = async (file: File, kind: "image" | "file") => {
    if (!activeConversation) {
      return;
    }
    const localUrl = kind === "image" ? URL.createObjectURL(file) : null;
    const localContentJson = {
      fileName: file.name,
      sizeBytes: file.size,
      contentType: file.type || "application/octet-stream",
      url: localUrl,
    };
    const localMessage = createLocalMessage(
      kind,
      kind === "image" ? "[图片]" : `[文件] ${file.name}`,
      localContentJson,
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
      const contentJson = fileContentJson(uploaded);
      const saved = await postTypedChatMessage({
        conversationId: activeConversation.id,
        messageType: kind,
        content: kind === "image" ? "[图片]" : `[文件] ${uploaded.originalName || file.name}`,
        contentJson,
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
      setDataSource((current) => ({ ...current, error: String(error) }));
    }
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
    const contentJson = {
        fileId: sticker.fileObjectId,
        fileName: sticker.fileName,
        sizeBytes: sticker.sizeBytes,
        contentType: sticker.contentType || "image/webp",
        url: null,
    };
    const localMessage = createLocalMessage(
      "sticker",
      "[表情]",
      contentJson,
      sticker.fileObjectId,
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
      setDataSource((current) => ({ ...current, error: String(error) }));
    }
  };

  const handleAttachmentSelection = (
    fileList: FileList | null,
    kind: "image" | "file",
  ) => {
    const file = fileList?.[0];
    if (!file) {
      return;
    }
    void sendAttachmentMessage(file, kind);
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

  const openImagePreviewWindow = (message: ChatMessage) => {
    const imageItems = activeMessages
      .filter((item) => item.kind === "image" && item.status !== "revoked")
      .map(imagePreviewItemFromMessage)
      .filter(Boolean) as ImagePreviewItem[];
    if (imageItems.length === 0) {
      return;
    }
    const activeItem = imagePreviewItemFromMessage(message);
    void invoke("open_image_preview_window", {
      payload: {
        images: imageItems,
        activeId: activeItem?.id ?? imageItems[0].id,
      },
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
    try {
      await downloadChatFile(fileObjectId, fileNameFromMessage(message, "文件"));
    } catch (error) {
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
    setQuotedMessage({
      id: message.id,
      senderLabel: message.direction === "outgoing" ? "我" : activeConversation?.title || "对方",
      preview: messagePreview(message),
    });
    setMessageMenu(null);
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
    await forwardChatMessage(source, targetConversationId);
  };

  const removeSelectedMessagesLocally = () => {
    const selected = new Set(selectedMessageIds);
    setMessages((current) => current.filter((message) => !selected.has(message.id)));
    cancelMultiSelect();
  };

  const handleMessageMenuAction = (
    action: "forward" | "multi-select" | "quote" | "revoke" | "delete" | "download",
    message: ChatMessage,
  ) => {
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
      setMessageMenu(null);
      void revokeMessage(message);
      return;
    }
    if (action === "delete") {
      void removeMessageLocally(message.id);
      return;
    }
    if (action === "download") {
      setMessageMenu(null);
      void downloadMessageFile(message);
      return;
    }
  };

  const displayedFriends = friends.map(
    (friend) => profileMap[friend.userId] ?? friend,
  );
  const activeContactProfile =
    activeContactUserId !== null
      ? displayedFriends.find((friend) => friend.userId === activeContactUserId) ??
        profileMap[activeContactUserId] ??
        null
      : null;
  const pendingIncomingRequestCount = friendRequests.filter((request) =>
    isIncomingPendingRequest(request, currentUserId),
  ).length;
  const pendingGroupRequestCount = groupRequests.filter((request) =>
    isPendingGroupRequest(request),
  ).length;
  const contactNoticeCount = pendingIncomingRequestCount + pendingGroupRequestCount;

  return (
    <main className="chat-window-root" onClick={closeContextMenus}>
      <ChatTitleBar />
      <section className="chat-shell">
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
                    <button
                      type="button"
                      onClick={openCreateGroupDialog}
                    >
                      创建群聊
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
                        <Avatar
                          label={displayedConversation.participant.avatar}
                          imageUrl={displayedConversation.participant.avatarUrl}
                          tone={conversation.kind}
                        />
                        <span
                          className={`presence-dot ${displayedConversation.participant.presence}`}
                        />
                        <span className="conversation-main">
                          <span className="conversation-title-row">
                            <strong>{displayedConversation.title}</strong>
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
                  <input placeholder="搜索好友" readOnly />
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
                requests={friendRequests}
                groupRequests={groupRequests}
                currentUserId={currentUserId}
                activeUserId={activeContactUserId}
                activeView={contactDetailView}
                loading={contactsLoading}
                error={contactsError}
                onOpenFriendRequests={openFriendRequests}
                onOpenGroupRequests={openGroupRequests}
                onSelectFriend={selectFriendContact}
                onAddFriend={openProfileSearchWindow}
              />
            </>
          )}
        </aside>

        {activeSection === "messages" ? (
          displayedActiveConversation ? (
            <section className="chat-main-panel" ref={chatMainPanelRef}>
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
                    ref={groupSettingsToggleRef}
                    type="button"
                    className={`icon-only ${
                      displayedActiveConversation.kind === "group" && groupSettingsOpen
                        ? "is-active"
                        : ""
                    }`}
                    title={
                      displayedActiveConversation.kind === "group"
                        ? groupSettingsOpen
                          ? "收起群设置"
                          : "打开群设置"
                        : "更多"
                    }
                    onClick={() => {
                      if (displayedActiveConversation.kind === "group") {
                        setGroupSettingsOpen((open) => !open);
                      }
                    }}
                  >
                    <ChatIcon name="ellipsis" />
                  </button>
                </div>
              </header>

              <div
                className={`chat-content-row ${
                  displayedActiveConversation.kind === "group"
                    ? `has-group-overview ${
                        groupOverviewHidden ? "is-group-overview-collapsed" : ""
                      }`
                    : ""
                }`}
              >
                <div className="chat-message-scroll" ref={messageScrollRef}>
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
                    activeMessages.map((message) =>
                      <MessageRenderer
                        key={message.id}
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
                        onPreviewImage={openImagePreviewWindow}
                        onOpenContextMenu={openMessageMenu}
                        onToggleSelected={() => toggleSelectedMessage(message.id)}
                        onDownloadFile={downloadMessageFile}
                      />,
                    )
                  ) : (
                    <div className="message-system">
                      {displayedActiveConversation.kind === "group"
                        ? "群聊已创建，现在可以开始聊天"
                        : "已添加为好友，现在可以开始聊天"}
                    </div>
                  )}
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
                    onOpenProfile={openGroupMemberProfile}
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
                  onInvite={openInviteGroupDialog}
                  onRemove={openRemoveGroupDialog}
                  onMemberMenu={(event, userId) => {
                    if (activeGroupId) {
                      openGroupMemberMenu(event, activeGroupId, userId);
                    }
                  }}
                  onLeave={() => requestGroupMemberAction("leave-group")}
                  onDissolve={() => requestGroupMemberAction("dissolve-group")}
                  onOpenProfile={openGroupMemberProfile}
                />
              ) : null}

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
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <ChatIcon name="folder" />
                    </button>
                    <button
                      type="button"
                      title="图片"
                      onClick={() => imageInputRef.current?.click()}
                    >
                      <ChatIcon name="camera" />
                    </button>
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
                      ref={imageInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
                      hidden
                      onChange={(event) => {
                        handleAttachmentSelection(event.currentTarget.files, "image");
                        event.currentTarget.value = "";
                      }}
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      hidden
                      onChange={(event) => {
                        handleAttachmentSelection(event.currentTarget.files, "file");
                        event.currentTarget.value = "";
                      }}
                    />
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
                {quotedMessage ? (
                  <div className="composer-quote-bar">
                    <span>
                      引用 {quotedMessage.senderLabel}: {quotedMessage.preview}
                    </span>
                    <button type="button" onClick={() => setQuotedMessage(null)}>
                      ×
                    </button>
                  </div>
                ) : null}
                <div className="composer-input-row">
                  <textarea
                    ref={draftInputRef}
                    value={draft}
                    placeholder="输入消息..."
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
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
        ) : (
          <section className="chat-main-panel is-empty" ref={chatMainPanelRef}>
            <ContactDetailPanel
              view={contactDetailView}
              profile={activeContactProfile}
              requests={friendRequests}
              groupRequests={groupRequests}
              currentUserId={currentUserId}
              loading={contactsLoading}
              error={contactsError}
              onAddFriend={openProfileSearchWindow}
              onSendMessage={(profile) => void openDirectConversation(profile.userId)}
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
        )}
      </section>

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

      {createGroupOpen ? (
        <CreateGroupDialog
          friends={displayedFriends}
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

function MessageContextMenuView({
  menu,
  message,
  onAction,
}: {
  menu: NonNullable<MessageContextMenu>;
  message?: ChatMessage;
  onAction: (
    action: "forward" | "multi-select" | "quote" | "revoke" | "delete" | "download",
    message: ChatMessage,
  ) => void;
}) {
  if (!message) {
    return null;
  }
  const canDownload =
    message.kind === "image" || message.kind === "file" || message.kind === "sticker";
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
      <button type="button" onClick={() => onAction("forward", message)}>
        转发
      </button>
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
      {canDownload ? (
        <button type="button" onClick={() => onAction("download", message)}>
          下载
        </button>
      ) : null}
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

function CreateGroupDialog({
  friends,
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

  return (
    <div className="chat-modal-backdrop group-create-backdrop" onClick={onClose}>
      <section
        className="group-create-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>创建群聊</h2>
            <p>已选 {selectedIds.length} 人，创建后将直接入群</p>
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
                        <em>{friend.bio || `ID ${friend.userId}`}</em>
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
  onOpenProfile,
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
  onOpenProfile: (userId: number) => void;
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
                      onClick={() => onOpenProfile(member.userId)}
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
  onInvite,
  onRemove,
  onMemberMenu,
  onLeave,
  onDissolve,
  onOpenProfile,
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
  onInvite: () => void;
  onRemove: () => void;
  onMemberMenu: (event: MouseEvent<HTMLElement>, userId: number) => void;
  onLeave: () => void;
  onDissolve: () => void;
  onOpenProfile: (userId: number) => void;
}) {
  const memberCount = group?.memberCount ?? conversation.groupMemberCount ?? members.length;
  const canEdit = group?.currentUserRole === "owner" || group?.currentUserRole === "admin";
  const myMember = members.find((member) => member.userId === currentUserId);
  const groupTitle = group?.name || conversation.title;
  const groupAvatarUrl = group?.avatarUrl || conversation.participant.avatarUrl || null;
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
            <section className="group-settings-card group-settings-summary">
              <Avatar
                label={conversation.participant.avatar}
                imageUrl={groupAvatarUrl}
                tone="group"
              />
              <div>
                <h2>{groupTitle}</h2>
                <p>{memberCount}/{group?.memberLimit ?? 500}</p>
              </div>
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
                    onClick={() => onOpenProfile(member.userId)}
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

function MessageRenderer({
  message,
  conversation,
  myProfile,
  profiles,
  multiSelectMode,
  selected,
  highlighted,
  onOpenFriendProfile,
  onPreviewImage,
  onOpenContextMenu,
  onToggleSelected,
  onDownloadFile,
}: {
  message: ChatMessage;
  conversation: ChatConversation;
  myProfile: UserProfile | null;
  profiles: Record<number, UserProfile>;
  multiSelectMode: boolean;
  selected: boolean;
  highlighted: boolean;
  onOpenFriendProfile: (userId?: number) => void;
  onPreviewImage: (message: ChatMessage) => void;
  onOpenContextMenu: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void;
  onToggleSelected: () => void;
  onDownloadFile: (message: ChatMessage) => void;
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
        {message.kind === "image" ? (
          <ImageMessageRenderer
            message={message}
            onPreview={() => onPreviewImage(message)}
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
        ) : (
          <TextMessageRenderer message={message} />
        )}
        <div className="message-meta-row">
          {message.status === "sending" ? <span>发送中</span> : null}
          {message.status === "failed" ? <span className="message-failed">发送失败</span> : null}
          {message.timeLabel ? <span>{message.timeLabel}</span> : null}
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
  const quote = quoteFromMessage(message);
  return (
    <>
      {quote ? (
        <div className="message-quote">
          <strong>{quote.senderLabel}</strong>
          <span>{quote.preview}</span>
        </div>
      ) : null}
      <p>{message.content}</p>
    </>
  );
}

function StickerMessageRenderer({ message }: { message: ChatMessage }) {
  const fileObjectId = fileObjectIdFromMessage(message);
  const [url, setUrl] = useState(fileObjectId ? "" : fileUrlFromMessage(message));
  useEffect(() => {
    if (url || !fileObjectId) {
      return;
    }
    let disposed = false;
    void cacheChatFile(fileObjectId, fileNameFromMessage(message, "表情"))
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
    return <div className="message-sticker-placeholder">[表情]</div>;
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
    let disposed = false;
    void cacheChatFile(fileObjectId, fileNameFromMessage(message, "图片"))
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
        <span>{message.content || "[图片]"}</span>
      </button>
    );
  }
  return (
    <button type="button" className="message-image-button" onClick={onPreview}>
      <img src={url} alt={fileNameFromMessage(message, "图片")} />
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
  return (
    <div className="message-file-card">
      <div className="message-file-icon">
        <ChatIcon name="folder" />
      </div>
      <div className="message-file-main">
        <strong>{fileName}</strong>
        <span>{size > 0 ? formatBytes(size) : "文件"}</span>
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

function ContactList({
  friends,
  requests,
  groupRequests,
  currentUserId,
  activeUserId,
  activeView,
  loading,
  error,
  onOpenFriendRequests,
  onOpenGroupRequests,
  onSelectFriend,
  onAddFriend,
}: {
  friends: UserProfile[];
  requests: FriendRequest[];
  groupRequests: ChatGroupJoinRequest[];
  currentUserId: number;
  activeUserId: number | null;
  activeView: ContactDetailView;
  loading: boolean;
  error?: string | null;
  onOpenFriendRequests: () => void;
  onOpenGroupRequests: () => void;
  onSelectFriend: (profile: UserProfile) => void;
  onAddFriend: () => void;
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

      <h3 className="contact-section-title">好友列表</h3>
      {loading && friends.length === 0 ? (
        <p className="contact-list-message">正在加载联系人...</p>
      ) : null}
      {error ? <p className="contact-list-message is-error">{error}</p> : null}
      {friends.length > 0 ? (
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
            <ProfileAvatarLite profile={friend} />
            <span className={`presence-dot ${friend.online ? "online" : "offline"}`} />
            <span className="contact-entry-main">
              <strong>{friend.nickname}</strong>
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
      )}

      <h3 className="contact-section-title">群聊列表</h3>
      <p className="contact-list-message">群聊稍后接入</p>
    </div>
  );
}

function ContactDetailPanel({
  view,
  profile,
  requests,
  groupRequests,
  currentUserId,
  loading,
  error,
  onAddFriend,
  onSendMessage,
  onAccept,
  onReject,
  onAcceptGroupRequest,
  onRejectGroupRequest,
}: {
  view: ContactDetailView;
  profile: UserProfile | null;
  requests: FriendRequest[];
  groupRequests: ChatGroupJoinRequest[];
  currentUserId: number;
  loading: boolean;
  error?: string | null;
  onAddFriend: () => void;
  onSendMessage: (profile: UserProfile) => void;
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
  return (
    <span
      className={`chat-avatar tone-${tone} ${imageUrl ? "has-image" : ""}`}
      style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
    >
      {imageUrl ? "" : label}
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
  if (
    conversation.title === title &&
    conversation.participant.name === title &&
    conversation.participant.avatar === avatar &&
    conversation.participant.avatarUrl === avatarUrl &&
    conversation.participant.presence === presence
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
  [...current, ...incoming].forEach((message) => {
    map.set(message.id, message);
  });
  return Array.from(map.values()).sort(compareMessages);
}

function compareMessages(left: ChatMessage, right: ChatMessage): number {
  const leftSeq = left.conversationSeq ?? Number.MAX_SAFE_INTEGER;
  const rightSeq = right.conversationSeq ?? Number.MAX_SAFE_INTEGER;
  if (leftSeq !== rightSeq) {
    return leftSeq - rightSeq;
  }
  return left.id.localeCompare(right.id);
}

function revokedMessageText(message: ChatMessage): string {
  return message.direction === "outgoing"
    ? "你撤回了一条消息"
    : "对方撤回了一条消息";
}

function fileContentJson(file: UploadedChatFile): Record<string, unknown> {
  return {
    fileId: file.id,
    fileName: file.originalName || "未命名文件",
    sizeBytes: file.sizeBytes,
    contentType: file.contentType || "application/octet-stream",
    url: file.url || null,
  };
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

function friendlyError(error: string): string {
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
