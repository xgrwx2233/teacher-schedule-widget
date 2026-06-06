import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultLocalAccountState, type LocalAccountState } from "../features/account/types";
import { AUTH_STATE_CHANGED_EVENT, AUTH_WINDOW_CLOSED_EVENT, WIDGET_WINDOW_LABEL } from "../features/settings/windowEvents";

type AuthMode = "password-login" | "code-login" | "register";

export function AuthWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [accountState, setAccountState] = useState<LocalAccountState>(defaultLocalAccountState);
  const [mode, setMode] = useState<AuthMode>("password-login");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshState = useCallback(async () => {
    const nextState = await invoke<LocalAccountState>("load_local_account_state");
    setAccountState(nextState);
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const closeWindow = useCallback(async () => {
    await emitTo(WIDGET_WINDOW_LABEL, AUTH_WINDOW_CLOSED_EVENT);
    await currentWindow.hide();
  }, [currentWindow]);

  useEffect(() => {
    const unlistenPromise = currentWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await closeWindow();
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [closeWindow, currentWindow]);

  const notifyAuthChanged = async (nextState: LocalAccountState) => {
    setAccountState(nextState);
    await emitTo(WIDGET_WINDOW_LABEL, AUTH_STATE_CHANGED_EVENT, nextState);
  };

  const requestCode = () => {
    setCode("1234");
    setMessage("验证码已发送");
  };

  const runAuthAction = async () => {
    setMessage("");
    if (mode === "register" && password !== repeatPassword) {
      setMessage("两次输入的密码不一致");
      return;
    }

    try {
      setBusy(true);
      const nextState = mode === "register"
        ? await invoke<LocalAccountState>("register_local_account", { phone, code, password })
        : mode === "code-login"
          ? await invoke<LocalAccountState>("login_with_code", { phone, code })
          : await invoke<LocalAccountState>("login_with_password", { phone, password });
      await notifyAuthChanged(nextState);
      setPassword("");
      setRepeatPassword("");
      setMessage(mode === "register" ? "注册成功" : "登录成功");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try {
      setBusy(true);
      const nextState = await invoke<LocalAccountState>("logout_local_account");
      await notifyAuthChanged(nextState);
      setMessage("已退出登录");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const isRegister = mode === "register";
  const isCodeMode = mode === "code-login" || isRegister;
  const primaryLabel = isRegister ? "注册并登录" : "登录";

  return (
    <main className="dialog-window-root">
      <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label="登录">
        <section className="auth-window">
          <header className="auth-header">
            <div>
              <h1>账号</h1>
              <p>{accountState.loggedIn ? "已登录，课程表会保存在当前账号下。" : "未登录时也可以继续使用本地课程表。"}</p>
            </div>
            <div className={accountState.loggedIn ? "auth-avatar is-online" : "auth-avatar"} aria-hidden="true">
              {accountState.loggedIn ? getAvatarText(accountState.user?.phone) : <UserIcon />}
            </div>
          </header>

          {accountState.loggedIn ? (
            <section className="auth-card">
              <div className="auth-account-row">
                <span>当前账号</span>
                <strong>{formatPhone(accountState.user?.phone)}</strong>
              </div>
              <div className="auth-account-row">
                <span>同步状态</span>
                <strong>本地可用</strong>
              </div>
              <button type="button" className="auth-secondary-button" disabled={busy} onClick={logout}>
                退出登录
              </button>
            </section>
          ) : (
            <>
              <nav className="auth-tabs" aria-label="登录方式">
                <button type="button" className={mode === "password-login" ? "is-active" : ""} onClick={() => setMode("password-login")}>
                  密码登录
                </button>
                <button type="button" className={mode === "code-login" ? "is-active" : ""} onClick={() => setMode("code-login")}>
                  验证码登录
                </button>
                <button type="button" className={mode === "register" ? "is-active" : ""} onClick={() => setMode("register")}>
                  注册
                </button>
              </nav>

              <section className="auth-card auth-form-card">
                <label className="auth-field">
                  <span>手机号</span>
                  <input value={phone} inputMode="tel" maxLength={11} onChange={(event) => setPhone(event.currentTarget.value)} />
                </label>

                {isCodeMode ? (
                  <label className="auth-field">
                    <span>验证码</span>
                    <div className="auth-code-row">
                      <input value={code} inputMode="numeric" maxLength={6} onChange={(event) => setCode(event.currentTarget.value)} />
                      <button type="button" onClick={requestCode}>
                        获取验证码
                      </button>
                    </div>
                  </label>
                ) : null}

                {!isCodeMode || isRegister ? (
                  <label className="auth-field">
                    <span>密码</span>
                    <input value={password} type="password" onChange={(event) => setPassword(event.currentTarget.value)} />
                  </label>
                ) : null}

                {isRegister ? (
                  <label className="auth-field">
                    <span>重复输入密码</span>
                    <input value={repeatPassword} type="password" onChange={(event) => setRepeatPassword(event.currentTarget.value)} />
                  </label>
                ) : null}

                <button type="button" className="auth-primary-button" disabled={busy} onClick={runAuthAction}>
                  {primaryLabel}
                </button>
              </section>
            </>
          )}

          {message ? <div className="auth-message">{message}</div> : null}
        </section>
      </div>
    </main>
  );
}

function formatPhone(phone: string | null | undefined): string {
  if (!phone) {
    return "本地账号";
  }

  return `${phone.slice(0, 3)} ${phone.slice(3, 7)} ${phone.slice(7)}`;
}

function getAvatarText(phone: string | null | undefined): string {
  return phone?.slice(-2) || "账";
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M12 12.2a3.7 3.7 0 1 0 0-7.4 3.7 3.7 0 0 0 0 7.4Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 20a6.7 6.7 0 0 1 13 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
