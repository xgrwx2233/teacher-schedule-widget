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
  lastSyncError?: string | null;
  hasPendingChanges: boolean;
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
  lastSyncError: null,
  hasPendingChanges: false,
};
