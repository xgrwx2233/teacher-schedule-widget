export type PublicUser = {
  id: string;
  phone?: string | null;
  isDefault: boolean;
  cloudUserId?: string | null;
};

export type LocalAccountState = {
  ownerUserId: string;
  loggedIn: boolean;
  user?: PublicUser | null;
};

export type StoredSchedulePayload<TSchedule> = {
  ownerUserId: string;
  schedule?: TSchedule | null;
};

export type LocalSyncStatus = {
  ownerUserId: string;
  dirtyCount: number;
  localRevision: number;
  cloudRevision?: number | null;
  lastSyncedCloudRevision?: number | null;
  lastSyncedAt?: string | null;
  lastCheckedAt?: string | null;
  lastSyncError?: string | null;
  hasPendingChanges: boolean;
  hasRemoteChanges: boolean;
  syncing: boolean;
  online: boolean;
  conflict: boolean;
};

export const defaultLocalAccountState: LocalAccountState = {
  ownerUserId: "default_local",
  loggedIn: false,
  user: null,
};

export const defaultLocalSyncStatus: LocalSyncStatus = {
  ownerUserId: "default_local",
  dirtyCount: 0,
  localRevision: 0,
  cloudRevision: null,
  lastSyncedCloudRevision: null,
  lastSyncedAt: null,
  lastCheckedAt: null,
  lastSyncError: null,
  hasPendingChanges: false,
  hasRemoteChanges: false,
  syncing: false,
  online: true,
  conflict: false,
};
