export type UserProfile = {
  userId: number;
  nickname: string;
  avatarUrl?: string | null;
  avatarObjectKey?: string | null;
  bio?: string | null;
  online: boolean;
  friendStatus: "self" | "none" | "friend" | "pending" | "rejected" | "unknown";
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ProfileSearchResult = {
  users: UserProfile[];
  groups: GroupSearchResult[];
};

export type GroupSearchResult = {
  id: string;
  conversationId: string;
  name: string;
  avatarUrl?: string | null;
  avatarObjectKey?: string | null;
  description?: string | null;
  announcement?: string | null;
  memberCount: number;
  memberLimit: number;
  joinPolicy: string;
  status: string;
  relationStatus: "none" | "pending" | "joined" | string;
  pendingRequestId?: number | null;
};

export type UploadedFile = {
  id: string;
  objectKey: string;
  fileType: string;
  contentType?: string | null;
  originalName?: string | null;
  sizeBytes: number;
  url?: string | null;
  createdAt?: string | null;
};

export type FriendRequest = {
  id: number;
  fromUserId: number;
  toUserId: number;
  message?: string | null;
  status: "pending" | "accepted" | "rejected";
  createdAt?: string | null;
  handledAt?: string | null;
  fromProfile?: UserProfile | null;
  toProfile?: UserProfile | null;
};
