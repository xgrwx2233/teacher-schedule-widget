import type {
  ChatConversation,
  ChatGroup,
  ChatGroupJoinRequest,
  ChatGroupMember,
  ChatMessage,
  ChatSticker,
} from "./types";
import type { FriendRequest, UserProfile } from "../profile/types";

export type ChatAccountCache = {
  version: 1;
  accountKey: string;
  savedAt: number;
  conversations: ChatConversation[];
  messages: ChatMessage[];
  friends: UserProfile[];
  friendRequests: FriendRequest[];
  groups: Record<string, ChatGroup>;
  groupMembers: Record<string, ChatGroupMember[]>;
  groupRequests: ChatGroupJoinRequest[];
  myProfile: UserProfile | null;
  profiles: Record<number, UserProfile>;
  avatarUrls: Record<string, string>;
  stickers: ChatSticker[];
  history?: Record<string, ChatHistoryConversationCache>;
  ui: {
    activeSection: "messages" | "contacts";
    activeConversationId: string;
    activeContactUserId: number | null;
    contactDetailView: "empty" | "friend" | "friend-requests" | "group-requests";
  };
};

export type ChatHistoryConversationCache = {
  oldestSeq: number | null;
  newestSeq: number | null;
  exhausted: boolean;
  updatedAt: number;
};

const CACHE_PREFIX = "teacher-assistant.chat-cache.v1.";

export function chatAccountKeyFromState(input: {
  loggedIn?: boolean;
  ownerUserId?: string | null;
  user?: { cloudUserId?: string | null } | null;
}): string | null {
  if (!input.loggedIn) {
    return null;
  }
  const cloudUserId = input.user?.cloudUserId?.trim();
  if (cloudUserId) {
    return `cloud:${cloudUserId}`;
  }
  const ownerUserId = input.ownerUserId?.trim();
  return ownerUserId ? `local:${ownerUserId}` : null;
}

export function loadChatAccountCache(accountKey: string): ChatAccountCache | null {
  try {
    const raw = window.localStorage.getItem(storageKey(accountKey));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as ChatAccountCache;
    if (parsed?.version !== 1 || parsed.accountKey !== accountKey) {
      return null;
    }
    return {
      ...parsed,
      avatarUrls: parsed.avatarUrls ?? {},
      stickers: parsed.stickers ?? [],
      groups: parsed.groups ?? {},
      groupMembers: parsed.groupMembers ?? {},
      groupRequests: parsed.groupRequests ?? [],
      history: parsed.history ?? {},
    };
  } catch {
    return null;
  }
}

export function saveChatAccountCache(
  accountKey: string | null,
  input: Omit<ChatAccountCache, "version" | "accountKey" | "savedAt">,
): void {
  if (!accountKey) {
    return;
  }
  try {
    const previous = loadChatAccountCache(accountKey);
    const cache: ChatAccountCache = {
      version: 1,
      accountKey,
      savedAt: Date.now(),
      ...input,
      groups: input.groups ?? previous?.groups ?? {},
      groupMembers: input.groupMembers ?? previous?.groupMembers ?? {},
      history: input.history ?? previous?.history ?? {},
    };
    window.localStorage.setItem(storageKey(accountKey), JSON.stringify(cache));
  } catch {
    // Cache write failure should not block the chat experience.
  }
}

export function loadCachedConversationMessages(
  accountKey: string | null,
  conversationId: string,
): ChatMessage[] {
  if (!accountKey || !conversationId) {
    return [];
  }
  const cache = loadChatAccountCache(accountKey);
  if (!cache) {
    return [];
  }
  return sortChatMessages(
    cache.messages.filter((message) => message.conversationId === conversationId),
  );
}

export function loadCachedConversationHistoryState(
  accountKey: string | null,
  conversationId: string,
): ChatHistoryConversationCache | null {
  if (!accountKey || !conversationId) {
    return null;
  }
  const cache = loadChatAccountCache(accountKey);
  return cache?.history?.[conversationId] ?? null;
}

export function mergeCachedConversationMessages(
  accountKey: string | null,
  conversationId: string,
  incomingMessages: ChatMessage[],
  options: { exhausted?: boolean | null } = {},
): ChatMessage[] {
  if (!accountKey || !conversationId) {
    return loadCachedConversationMessages(accountKey, conversationId);
  }

  const cache = loadChatAccountCache(accountKey);
  const currentMessages = cache?.messages ?? [];
  const scopedMessages = currentMessages.filter(
    (message) => message.conversationId === conversationId,
  );
  const mergedScopedMessages = mergeChatMessages(scopedMessages, incomingMessages);
  const otherMessages = currentMessages.filter(
    (message) => message.conversationId !== conversationId,
  );
  const nextMessages = sortChatMessages([...otherMessages, ...mergedScopedMessages]);
  const nextHistory = {
    ...(cache?.history ?? {}),
    [conversationId]: nextHistoryState(
      cache?.history?.[conversationId] ?? null,
      mergedScopedMessages,
      options.exhausted,
    ),
  };

  saveChatAccountCache(accountKey, {
    conversations: cache?.conversations ?? [],
    messages: nextMessages,
    friends: cache?.friends ?? [],
    friendRequests: cache?.friendRequests ?? [],
    groups: cache?.groups ?? {},
    groupMembers: cache?.groupMembers ?? {},
    groupRequests: cache?.groupRequests ?? [],
    myProfile: cache?.myProfile ?? null,
    profiles: cache?.profiles ?? {},
    avatarUrls: cache?.avatarUrls ?? {},
    stickers: cache?.stickers ?? [],
    history: nextHistory,
    ui: cache?.ui ?? {
      activeSection: "messages",
      activeConversationId: conversationId,
      activeContactUserId: null,
      contactDetailView: "empty",
    },
  });

  return mergedScopedMessages;
}

export function saveCachedConversationHistoryState(
  accountKey: string | null,
  conversationId: string,
  state: Partial<ChatHistoryConversationCache>,
): void {
  if (!accountKey || !conversationId) {
    return;
  }
  const cache = loadChatAccountCache(accountKey);
  const messages = loadCachedConversationMessages(accountKey, conversationId);
  const currentState = cache?.history?.[conversationId] ?? null;
  const nextHistory = {
    ...(cache?.history ?? {}),
    [conversationId]: {
      ...nextHistoryState(currentState, messages, currentState?.exhausted ?? false),
      ...state,
      updatedAt: Date.now(),
    },
  };
  saveChatAccountCache(accountKey, {
    conversations: cache?.conversations ?? [],
    messages: cache?.messages ?? [],
    friends: cache?.friends ?? [],
    friendRequests: cache?.friendRequests ?? [],
    groups: cache?.groups ?? {},
    groupMembers: cache?.groupMembers ?? {},
    groupRequests: cache?.groupRequests ?? [],
    myProfile: cache?.myProfile ?? null,
    profiles: cache?.profiles ?? {},
    avatarUrls: cache?.avatarUrls ?? {},
    stickers: cache?.stickers ?? [],
    history: nextHistory,
    ui: cache?.ui ?? {
      activeSection: "messages",
      activeConversationId: conversationId,
      activeContactUserId: null,
      contactDetailView: "empty",
    },
  });
}

export function removeCachedConversationMessage(
  accountKey: string | null,
  conversationId: string,
  messageId: string,
): void {
  if (!accountKey || !conversationId || !messageId) {
    return;
  }
  const cache = loadChatAccountCache(accountKey);
  if (!cache) {
    return;
  }
  const nextMessages = cache.messages.filter(
    (message) =>
      message.conversationId !== conversationId || message.id !== messageId,
  );
  saveChatAccountCache(accountKey, {
    conversations: cache.conversations,
    messages: nextMessages,
    friends: cache.friends,
    friendRequests: cache.friendRequests,
    groups: cache.groups ?? {},
    groupMembers: cache.groupMembers ?? {},
    groupRequests: cache.groupRequests ?? [],
    myProfile: cache.myProfile,
    profiles: cache.profiles,
    avatarUrls: cache.avatarUrls,
    stickers: cache.stickers,
    history: cache.history,
    ui: cache.ui,
  });
}

export function clearCachedConversationMessages(
  accountKey: string | null,
  conversationId: string,
): void {
  if (!accountKey || !conversationId) {
    return;
  }
  const cache = loadChatAccountCache(accountKey);
  if (!cache) {
    return;
  }
  const nextMessages = cache.messages.filter(
    (message) => message.conversationId !== conversationId,
  );
  const nextHistory = { ...(cache.history ?? {}) };
  delete nextHistory[conversationId];
  saveChatAccountCache(accountKey, {
    conversations: cache.conversations,
    messages: nextMessages,
    friends: cache.friends,
    friendRequests: cache.friendRequests,
    groups: cache.groups ?? {},
    groupMembers: cache.groupMembers ?? {},
    groupRequests: cache.groupRequests ?? [],
    myProfile: cache.myProfile,
    profiles: cache.profiles,
    avatarUrls: cache.avatarUrls,
    stickers: cache.stickers,
    history: nextHistory,
    ui: cache.ui,
  });
}

function storageKey(accountKey: string): string {
  return `${CACHE_PREFIX}${accountKey}`;
}

function mergeChatMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  [...current, ...incoming].forEach((message) => {
    map.set(message.id, message);
  });
  return sortChatMessages(Array.from(map.values()));
}

function sortChatMessages(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((left, right) => {
    const leftSeq = left.conversationSeq ?? Number.MAX_SAFE_INTEGER;
    const rightSeq = right.conversationSeq ?? Number.MAX_SAFE_INTEGER;
    if (leftSeq !== rightSeq) {
      return leftSeq - rightSeq;
    }
    return left.id.localeCompare(right.id);
  });
}

function nextHistoryState(
  current: ChatHistoryConversationCache | null,
  messages: ChatMessage[],
  exhausted?: boolean | null,
): ChatHistoryConversationCache {
  const seqs = messages
    .map((message) => message.conversationSeq)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    oldestSeq: seqs.length > 0 ? Math.min(...seqs) : current?.oldestSeq ?? null,
    newestSeq: seqs.length > 0 ? Math.max(...seqs) : current?.newestSeq ?? null,
    exhausted: exhausted ?? current?.exhausted ?? false,
    updatedAt: Date.now(),
  };
}
