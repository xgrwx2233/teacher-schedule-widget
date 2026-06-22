import { useEffect, useMemo, useRef, useState } from "react";
import { getRtcToken } from "../../features/rtc/rtcRepository";
import { errorToMessage, RtcService } from "../../features/rtc/rtcService";
import type { RtcConnectionStatus, RtcLogEntry, RtcRemoteUser, RtcToken } from "../../features/rtc/types";

type RtcTestPanelProps = {
  defaultChannelId: string;
  currentUserId: number | null;
  displayName: string;
  onClose: () => void;
};

const RTC_CHANNEL_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function RtcTestPanel({
  defaultChannelId,
  currentUserId,
  displayName,
  onClose,
}: RtcTestPanelProps) {
  const [channelId, setChannelId] = useState(defaultChannelId || "rtc_test_001");
  const [status, setStatus] = useState<RtcConnectionStatus>("idle");
  const [token, setToken] = useState<RtcToken | null>(null);
  const [remoteUsers, setRemoteUsers] = useState<RtcRemoteUser[]>([]);
  const [muted, setMuted] = useState(false);
  const [logs, setLogs] = useState<RtcLogEntry[]>([]);
  const serviceRef = useRef<RtcService | null>(null);

  useEffect(() => {
    serviceRef.current = new RtcService((event) => {
      if (event.type === "log") {
        appendLog(event.level, event.message);
        return;
      }
      if (event.type === "remote-users") {
        setRemoteUsers(event.users);
        return;
      }
      if (event.type === "joined") {
        setStatus("joined");
        return;
      }
      if (event.type === "left") {
        setStatus("idle");
        setMuted(false);
        setRemoteUsers([]);
        return;
      }
      if (event.type === "muted") {
        setMuted(event.muted);
      }
    });
    appendLog("info", "RTC 测试面板已打开。");
    return () => {
      void serviceRef.current?.leave();
      serviceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (status === "idle" && defaultChannelId) {
      setChannelId(defaultChannelId);
    }
  }, [defaultChannelId, status]);

  const channelValid = useMemo(
    () => RTC_CHANNEL_PATTERN.test(channelId.trim()),
    [channelId],
  );
  const joined = status === "joined";
  const busy = status === "checking" || status === "joining" || status === "leaving";
  const canUseRtc = Boolean(currentUserId) && channelValid;

  const appendLog = (
    level: RtcLogEntry["level"],
    message: string,
  ) => {
    setLogs((current) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          level,
          message,
          createdAt: Date.now(),
        },
        ...current,
      ].slice(0, 80),
    );
  };

  const requestToken = async (): Promise<RtcToken> => {
    const normalizedChannel = channelId.trim();
    const nextToken = await getRtcToken(normalizedChannel);
    setToken(nextToken);
    appendLog("success", `已获取 RTC token，有效期 ${nextToken.ttlSeconds} 秒。`);
    return nextToken;
  };

  const checkEnvironment = async () => {
    if (!serviceRef.current) {
      return;
    }
    setStatus("checking");
    try {
      await serviceRef.current.checkSupport();
      await serviceRef.current.requestMicrophonePermission();
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      appendLog("error", errorToMessage(error));
    }
  };

  const handleGetToken = async () => {
    if (!canUseRtc) {
      appendLog("error", "请先登录并填写合法频道 ID。");
      return;
    }
    try {
      await requestToken();
    } catch (error) {
      appendLog("error", errorToMessage(error));
    }
  };

  const handleJoin = async () => {
    if (!serviceRef.current || !canUseRtc) {
      appendLog("error", "请先登录并填写合法频道 ID。");
      return;
    }
    setStatus("joining");
    try {
      await serviceRef.current.checkSupport();
      await serviceRef.current.requestMicrophonePermission();
      const nextToken = token?.channelId === channelId.trim()
        ? token
        : await requestToken();
      await serviceRef.current.join(nextToken, {
        displayName,
        tokenProvider: (nextChannelId) => getRtcToken(nextChannelId),
      });
    } catch (error) {
      setStatus("error");
      appendLog("error", errorToMessage(error));
    }
  };

  const handleLeave = async () => {
    if (!serviceRef.current) {
      return;
    }
    setStatus("leaving");
    await serviceRef.current.leave().catch((error) => {
      appendLog("error", errorToMessage(error));
    });
  };

  const handleToggleMute = () => {
    serviceRef.current?.muteLocalMic(!muted);
  };

  return (
    <div className="chat-modal-backdrop rtc-test-backdrop" onClick={onClose}>
      <section className="rtc-test-panel" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>RTC 基础设施测试</h2>
            <p>只验证同频道音频互通，不接入正式通话业务</p>
          </div>
          <button type="button" title="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="rtc-test-grid">
          <section className="rtc-test-control">
            <label>
              <span>频道 ID</span>
              <input
                value={channelId}
                maxLength={64}
                disabled={joined || busy}
                onChange={(event) => {
                  setChannelId(event.target.value.trim());
                  setToken(null);
                }}
              />
            </label>
            {!channelValid ? (
              <p className="rtc-test-error">
                频道 ID 只能包含字母、数字、下划线、短横线，长度 1-64。
              </p>
            ) : null}

            <dl className="rtc-test-meta">
              <div>
                <dt>当前用户</dt>
                <dd>{currentUserId ? String(currentUserId) : "未登录"}</dd>
              </div>
              <div>
                <dt>连接状态</dt>
                <dd>{statusText(status)}</dd>
              </div>
              <div>
                <dt>Token</dt>
                <dd>{token ? `到期 ${formatExpireTime(token.timestamp)}` : "未获取"}</dd>
              </div>
            </dl>

            <div className="rtc-test-actions">
              <button type="button" disabled={busy} onClick={checkEnvironment}>
                检测环境
              </button>
              <button type="button" disabled={!canUseRtc || busy || joined} onClick={handleGetToken}>
                获取 token
              </button>
              <button
                type="button"
                className="profile-primary-button"
                disabled={!canUseRtc || busy || joined}
                onClick={handleJoin}
              >
                加入频道
              </button>
              <button type="button" disabled={!joined} onClick={handleToggleMute}>
                {muted ? "取消静音" : "静音"}
              </button>
              <button type="button" className="danger" disabled={!joined && !busy} onClick={handleLeave}>
                离开
              </button>
            </div>
          </section>

          <section className="rtc-test-remote">
            <h3>远端用户</h3>
            {remoteUsers.length > 0 ? (
              <div className="rtc-test-remote-list">
                {remoteUsers.map((user) => (
                  <div key={user.userId}>
                    <strong>{user.userId}</strong>
                    <span>{user.audioAvailable ? "音频可用" : "等待音频"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p>暂无远端用户。两台客户端填写同一个频道 ID 后加入即可测试。</p>
            )}
          </section>
        </div>

        <section className="rtc-test-log">
          <h3>测试日志</h3>
          <div>
            {logs.length > 0 ? (
              logs.map((log) => (
                <p key={log.id} className={`is-${log.level}`}>
                  <time>{formatLogTime(log.createdAt)}</time>
                  <span>{log.message}</span>
                </p>
              ))
            ) : (
              <p className="rtc-test-log-empty">暂无日志</p>
            )}
          </div>
        </section>
      </section>
    </div>
  );
}

function statusText(status: RtcConnectionStatus): string {
  switch (status) {
    case "checking":
      return "检测中";
    case "ready":
      return "可加入";
    case "joining":
      return "加入中";
    case "joined":
      return "已加入";
    case "leaving":
      return "离开中";
    case "error":
      return "异常";
    case "idle":
    default:
      return "未连接";
  }
}

function formatExpireTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatLogTime(value: number): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(
    2,
    "0",
  )}:${String(date.getSeconds()).padStart(2, "0")}`;
}

