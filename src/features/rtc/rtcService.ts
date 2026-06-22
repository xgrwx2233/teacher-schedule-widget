import type { RtcRemoteUser, RtcToken } from "./types";

type AliRtcSdkModule = typeof import("aliyun-rtc-sdk");
type AliRtcEngineClass = AliRtcSdkModule["default"];
type AliRtcEngineInstance = InstanceType<AliRtcEngineClass>;

export type RtcServiceEvent =
  | { type: "log"; level: "info" | "success" | "warning" | "error"; message: string }
  | { type: "remote-users"; users: RtcRemoteUser[] }
  | { type: "joined"; channelId: string; userId: string }
  | { type: "left" }
  | { type: "muted"; muted: boolean };

export type RtcServiceListener = (event: RtcServiceEvent) => void;

export class RtcService {
  private engine: AliRtcEngineInstance | null = null;
  private sdk: AliRtcSdkModule | null = null;
  private listener: RtcServiceListener;
  private remoteUsers = new Map<string, RtcRemoteUser>();
  private joined = false;
  private muted = false;
  private lastToken: RtcToken | null = null;
  private tokenProvider: ((channelId: string) => Promise<RtcToken>) | null = null;

  constructor(listener: RtcServiceListener) {
    this.listener = listener;
  }

  async checkSupport(): Promise<void> {
    const sdk = await this.loadSdk();
    if (!sdk.default.isSupported) {
      this.emit("warning", "当前 SDK 未暴露 WebRTC 支持检测接口，已跳过 SDK 检测。");
      return;
    }
    const result = await sdk.default.isSupported("sendrecv");
    if (!result.support) {
      throw new Error("当前 WebView 不支持 RTC 音频通话");
    }
    this.emit("success", "WebRTC 支持检测通过。");
  }

  async requestMicrophonePermission(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前环境不支持麦克风权限检测");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((track) => track.stop());
    this.emit("success", "麦克风权限检测通过。");
  }

  async join(
    token: RtcToken,
    options: {
      displayName: string;
      tokenProvider?: (channelId: string) => Promise<RtcToken>;
    },
  ): Promise<void> {
    await this.leave();
    this.tokenProvider = options.tokenProvider ?? null;
    this.lastToken = token;
    const sdk = await this.loadSdk();
    const engine = sdk.default.createInstance
      ? sdk.default.createInstance({ instanceId: `teacher-rtc-${token.channelId}-${token.userId}` })
      : sdk.default.getInstance();
    this.engine = engine;
    this.bindEngineEvents(engine);
    engine.setAudioOnlyMode(true);
    await engine.publishLocalVideoStream(false);
    await engine.publishLocalAudioStream(true);
    await engine.joinChannel(token, options.displayName || token.userId);
    this.joined = true;
    this.muted = false;
    this.emitEvent({ type: "joined", channelId: token.channelId, userId: token.userId });
    this.emit("success", `已加入 RTC 频道：${token.channelId}`);
  }

  muteLocalMic(muted: boolean): void {
    if (!this.engine || !this.joined) {
      return;
    }
    this.engine.muteLocalMic(muted);
    this.muted = muted;
    this.emitEvent({ type: "muted", muted });
    this.emit("info", muted ? "本地麦克风已静音。" : "本地麦克风已取消静音。");
  }

  async leave(): Promise<void> {
    if (!this.engine) {
      this.joined = false;
      this.remoteUsers.clear();
      return;
    }
    try {
      if (this.engine.isInCall?.()) {
        await this.engine.leaveChannel();
      }
    } finally {
      await this.engine.destroy().catch(() => undefined);
      this.engine = null;
      this.joined = false;
      this.muted = false;
      this.lastToken = null;
      this.remoteUsers.clear();
      this.emitEvent({ type: "remote-users", users: [] });
      this.emitEvent({ type: "left" });
      this.emit("info", "已离开 RTC 频道。");
    }
  }

  private async loadSdk(): Promise<AliRtcSdkModule> {
    if (!this.sdk) {
      this.sdk = await import("aliyun-rtc-sdk");
    }
    return this.sdk;
  }

  private bindEngineEvents(engine: AliRtcEngineInstance): void {
    engine.on("connectionStatusChange", (status, reason) => {
      this.emit("info", `连接状态变化：${String(status)} / ${String(reason)}`);
    });
    engine.on("remoteUserOnLineNotify", (uid) => {
      this.remoteUsers.set(uid, {
        userId: uid,
        audioAvailable: this.remoteUsers.get(uid)?.audioAvailable ?? false,
      });
      this.emitRemoteUsers();
      this.emit("success", `远端用户已加入：${uid}`);
    });
    engine.on("remoteUserOffLineNotify", (uid) => {
      this.remoteUsers.delete(uid);
      this.emitRemoteUsers();
      this.emit("info", `远端用户已离开：${uid}`);
    });
    engine.on("remoteTrackAvailableNotify", (uid, audioTrack) => {
      this.remoteUsers.set(uid, {
        userId: uid,
        audioAvailable: Number(audioTrack) !== 0,
      });
      this.emitRemoteUsers();
      this.emit("info", `远端音频状态变化：${uid}`);
    });
    engine.on("userAudioMuted", (uid, muted) => {
      this.emit("info", `${uid} ${muted ? "已静音" : "已取消静音"}`);
    });
    engine.on("audioSubscribeStateChanged", (uid, _oldState, newState) => {
      this.emit("info", `订阅远端音频：${uid} -> ${String(newState)}`);
    });
    engine.on("remoteAudioAutoPlayFail", (uid) => {
      this.emit("warning", `远端音频自动播放失败，请点击测试面板任意位置后重试：${uid}`);
    });
    engine.on("remoteAudioPlayError", (uid, reason) => {
      this.emit("error", `远端音频播放失败：${uid} ${reason ?? ""}`.trim());
    });
    engine.on("localDeviceException", (_deviceType, _exceptionType, description) => {
      this.emit("error", `本地设备异常：${description}`);
    });
    engine.on("authInfoWillExpire", () => {
      void this.refreshAuthInfo();
    });
    engine.on("authInfoExpired", () => {
      this.emit("error", "RTC 鉴权已过期，请离开后重新加入频道。");
    });
    engine.on("bye", (code) => {
      this.emit("warning", `已被服务端移出频道：${String(code)}`);
    });
  }

  private async refreshAuthInfo(): Promise<void> {
    if (!this.engine || !this.lastToken || !this.tokenProvider) {
      this.emit("warning", "RTC 鉴权即将过期，但当前没有可用的刷新方法。");
      return;
    }
    try {
      const token = await this.tokenProvider(this.lastToken.channelId);
      await this.engine.refreshAuthInfo(token);
      this.lastToken = token;
      this.emit("success", "RTC 鉴权已自动刷新。");
    } catch (error) {
      this.emit("error", `RTC 鉴权刷新失败：${errorToMessage(error)}`);
    }
  }

  private emitRemoteUsers(): void {
    this.emitEvent({
      type: "remote-users",
      users: Array.from(this.remoteUsers.values()).sort((a, b) =>
        a.userId.localeCompare(b.userId),
      ),
    });
  }

  private emit(
    level: "info" | "success" | "warning" | "error",
    message: string,
  ): void {
    this.emitEvent({ type: "log", level, message });
  }

  private emitEvent(event: RtcServiceEvent): void {
    this.listener(event);
  }
}

export function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "未知错误";
}

