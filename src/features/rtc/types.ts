export type RtcToken = {
  appId: string;
  channelId: string;
  userId: string;
  nonce: string;
  timestamp: number;
  token: string;
  ttlSeconds: number;
};

export type RtcLogLevel = "info" | "success" | "warning" | "error";

export type RtcLogEntry = {
  id: string;
  level: RtcLogLevel;
  message: string;
  createdAt: number;
};

export type RtcRemoteUser = {
  userId: string;
  audioAvailable: boolean;
};

export type RtcConnectionStatus = "idle" | "checking" | "ready" | "joining" | "joined" | "leaving" | "error";

