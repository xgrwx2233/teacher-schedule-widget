import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  ClassAccountApplyResult,
  FriendRequest,
  ProfileSearchResult,
  UploadedFile,
  UserProfile,
} from "./types";

export async function loadMyProfile(): Promise<UserProfile> {
  const response = await invoke<{ profile: UserProfile }>("load_my_profile");
  return response.profile;
}

export async function saveMyProfile(input: {
  nickname: string;
  avatarUrl?: string | null;
  avatarObjectKey?: string | null;
  bio?: string | null;
}): Promise<UserProfile> {
  const response = await invoke<{ profile: UserProfile }>("save_my_profile", {
    nickname: input.nickname,
    avatarUrl: input.avatarUrl ?? null,
    avatarObjectKey: input.avatarObjectKey ?? null,
    bio: input.bio ?? null,
  });
  return response.profile;
}

export async function loadUserProfile(userId: number): Promise<UserProfile> {
  const response = await invoke<{ profile: UserProfile }>("load_user_profile", {
    userId,
  });
  return response.profile;
}

export async function searchProfiles(
  keyword: string,
  scope: "all" | "users" | "groups",
): Promise<ProfileSearchResult> {
  return invoke<ProfileSearchResult>("search_profiles", { keyword, scope });
}

export async function applyClassAccount(input: {
  nickname: string;
  avatarUrl?: string | null;
  avatarObjectKey?: string | null;
  bio?: string | null;
  linkedPhone: string;
}): Promise<ClassAccountApplyResult> {
  return invoke<ClassAccountApplyResult>("apply_class_account", {
    nickname: input.nickname,
    avatarUrl: input.avatarUrl ?? null,
    avatarObjectKey: input.avatarObjectKey ?? null,
    bio: input.bio ?? null,
    linkedPhone: input.linkedPhone,
  });
}

export async function uploadProfileAvatarBytes(input: {
  filename: string;
  contentType?: string | null;
  bytes: number[];
}): Promise<UploadedFile> {
  const response = await invoke<{ file: UploadedFile }>(
    "upload_profile_avatar_bytes",
    {
      filename: input.filename,
      contentType: input.contentType ?? null,
      bytes: input.bytes,
    },
  );
  return response.file;
}

export async function cacheProfileAvatar(input: {
  accountKey: string;
  avatarKey: string;
  avatarUrl: string;
}): Promise<string> {
  const response = await invoke<{ path: string }>("cache_profile_avatar", {
    accountKey: input.accountKey,
    avatarKey: input.avatarKey,
    avatarUrl: input.avatarUrl,
  });
  if (!response.path) {
    return input.avatarUrl;
  }
  if (
    response.path.startsWith("http://") ||
    response.path.startsWith("https://") ||
    response.path.startsWith("asset:")
  ) {
    return response.path;
  }
  return convertFileSrc(response.path);
}

export async function sendFriendRequest(
  toUserId: number,
  message: string,
): Promise<FriendRequest> {
  const response = await invoke<{ request: FriendRequest }>("send_friend_request", {
    toUserId,
    message,
  });
  return response.request;
}

export async function listFriendRequests(): Promise<FriendRequest[]> {
  const response = await invoke<{ requests: FriendRequest[] }>("list_friend_requests");
  return response.requests;
}

export async function acceptFriendRequest(requestId: number): Promise<FriendRequest> {
  const response = await invoke<{ request: FriendRequest }>("accept_friend_request", {
    requestId,
  });
  return response.request;
}

export async function rejectFriendRequest(requestId: number): Promise<FriendRequest> {
  const response = await invoke<{ request: FriendRequest }>("reject_friend_request", {
    requestId,
  });
  return response.request;
}

export async function listFriends(): Promise<UserProfile[]> {
  const response = await invoke<{ friends: UserProfile[] }>("list_friends");
  return response.friends;
}

export async function deleteFriend(friendUserId: number): Promise<void> {
  await invoke("delete_friend", { friendUserId });
}

export function profileInitial(profile: UserProfile | null | undefined): string {
  const source = profile?.nickname?.trim() || "师";
  return source.slice(0, 1).toUpperCase();
}
