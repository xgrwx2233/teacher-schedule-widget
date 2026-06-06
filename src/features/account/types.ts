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

export const defaultLocalAccountState: LocalAccountState = {
  ownerUserId: "default_local",
  loggedIn: false,
  user: null,
};
