import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultLocalAccountState, type LocalAccountState } from "../features/account/types";
import { AUTH_STATE_CHANGED_EVENT, AUTH_WINDOW_CLOSED_EVENT, WIDGET_WINDOW_LABEL } from "../features/settings/windowEvents";

type AuthView = "password-login" | "code-login" | "class-code-login" | "register";

const AUTH_WINDOW_WIDTH = 380;
const AUTH_LOGIN_HEIGHT = 420;
const AUTH_REGISTER_HEIGHT = 500;
const AUTH_ACCOUNT_HEIGHT = 360;

export function AuthWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [accountState, setAccountState] = useState<LocalAccountState>(defaultLocalAccountState);
  const [view, setView] = useState<AuthView>("password-login");
  const [phone, setPhone] = useState("");
  const [classNo, setClassNo] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const isRegister = view === "register";
  const isClassLogin = view === "class-code-login";
  const isCodeView = view === "code-login" || isClassLogin || isRegister;
  const primaryLabel = isRegister ? "注册并登录" : "登录";
  const windowTitle = accountState.loggedIn ? "账号" : isRegister ? "创建账号" : "登录";

  const refreshState = useCallback(async () => {
    const nextState = await invoke<LocalAccountState>("load_local_account_state");
    setAccountState(nextState);
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  useEffect(() => {
    const height = accountState.loggedIn
      ? AUTH_ACCOUNT_HEIGHT
      : view === "register"
        ? AUTH_REGISTER_HEIGHT
        : AUTH_LOGIN_HEIGHT;

    void currentWindow.setSize(new LogicalSize(AUTH_WINDOW_WIDTH, height));
    void currentWindow.setTitle(windowTitle);
  }, [accountState.loggedIn, currentWindow, view, windowTitle]);

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
    await emit(AUTH_STATE_CHANGED_EVENT, nextState);
  };

  const requestCode = async () => {
    if (isClassLogin) {
      try {
        setBusy(true);
        const response = await invoke<{ phone?: string; code?: string }>(
          "request_class_login_code",
          { classNo },
        );
        setCode(response.code ?? "1234");
        setMessage(response.phone ? `验证码已发送至 ${response.phone}` : "验证码已发送");
      } catch (error) {
        setMessage(String(error));
      } finally {
        setBusy(false);
      }
      return;
    }
    setCode("1234");
    setMessage("验证码已发送");
  };

  const runAuthAction = async () => {
    setMessage("");
    if (view === "register" && password !== repeatPassword) {
      setMessage("两次输入的密码不一致");
      return;
    }

    try {
      setBusy(true);
      const nextState = view === "register"
        ? await invoke<LocalAccountState>("register_local_account", { phone, code, password })
        : view === "code-login"
          ? await invoke<LocalAccountState>("login_with_code", { phone, code })
          : view === "class-code-login"
            ? await invoke<LocalAccountState>("login_class_with_code", { classNo, code })
          : await invoke<LocalAccountState>("login_with_password", { phone, password });

      await notifyAuthChanged(nextState);
      setPassword("");
      setRepeatPassword("");
      setMessage(view === "register" ? "注册成功" : "登录成功");
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

  const switchView = (nextView: AuthView) => {
    setMessage("");
    setView(nextView);
  };

  return (
    <main className="dialog-window-root auth-window-root">
      <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label={windowTitle}>
        <section className={accountState.loggedIn ? "auth-window is-account-view" : isRegister ? "auth-window is-register-view" : "auth-window"}>
          {accountState.loggedIn ? (
            <>
              <header className="auth-header">
                <h1>账号</h1>
                <p>当前课程表已保存到本地账号。</p>
              </header>
              <section className="auth-account-panel">
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
            </>
          ) : (
            <section className={isRegister ? "auth-main is-register" : "auth-main"}>
              {!isRegister ? (
                <nav className="auth-tabs" aria-label="登录方式">
                  <button type="button" className={view === "password-login" ? "is-active" : ""} onClick={() => switchView("password-login")}>
                    密码登录
                  </button>
                  <button type="button" className={view === "code-login" ? "is-active" : ""} onClick={() => switchView("code-login")}>
                    验证码登录
                  </button>
                  <button type="button" className={view === "class-code-login" ? "is-active" : ""} onClick={() => switchView("class-code-login")}>
                    班级号登录
                  </button>
                </nav>
              ) : null}

              <form
                className="auth-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runAuthAction();
                }}
              >
                {isClassLogin ? (
                  <label className="auth-field">
                    <span>班级号</span>
                    <input value={classNo} inputMode="numeric" maxLength={8} autoComplete="off" onChange={(event) => setClassNo(event.currentTarget.value)} />
                  </label>
                ) : (
                  <label className="auth-field">
                    <span>手机号</span>
                    <input value={phone} inputMode="tel" maxLength={11} autoComplete="tel" onChange={(event) => setPhone(event.currentTarget.value)} />
                  </label>
                )}

                {isCodeView ? (
                  <label className="auth-field">
                    <span>验证码</span>
                    <div className="auth-code-row">
                      <input value={code} inputMode="numeric" maxLength={6} autoComplete="one-time-code" onChange={(event) => setCode(event.currentTarget.value)} />
                      <button type="button" disabled={busy} onClick={() => void requestCode()}>
                        获取验证码
                      </button>
                    </div>
                  </label>
                ) : null}

                {(!isCodeView || isRegister) && !isClassLogin ? (
                  <label className="auth-field">
                    <span>密码</span>
                    <input value={password} type="password" autoComplete={isRegister ? "new-password" : "current-password"} onChange={(event) => setPassword(event.currentTarget.value)} />
                  </label>
                ) : null}

                {isRegister ? (
                  <label className="auth-field">
                    <span>重复输入密码</span>
                    <input value={repeatPassword} type="password" autoComplete="new-password" onChange={(event) => setRepeatPassword(event.currentTarget.value)} />
                  </label>
                ) : null}

                <button type="submit" className="auth-primary-button" disabled={busy}>
                  {primaryLabel}
                </button>
              </form>

              {!isRegister ? (
                <p className="auth-register-hint">
                  没有账号？
                  <button type="button" onClick={() => switchView("register")}>
                    立即注册
                  </button>
                </p>
              ) : (
                <p className="auth-register-hint">
                  已有账号？
                  <button type="button" onClick={() => switchView("password-login")}>
                    返回登录
                  </button>
                </p>
              )}
            </section>
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
  if (phone.startsWith("class:")) {
    return `班级号 ${phone.slice("class:".length)}`;
  }

  return `${phone.slice(0, 3)} ${phone.slice(3, 7)} ${phone.slice(7)}`;
}
