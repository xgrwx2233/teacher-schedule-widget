import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState } from "react";
import {
  BLOCK_TYPE_CONFIRM_REQUEST_EVENT,
  BLOCK_TYPE_CONFIRM_RESPONSE_EVENT,
  type BlockTypeConfirmRequestPayload,
} from "../features/settings/windowEvents";

export function BlockTypeConfirmWindowHost() {
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [payload, setPayload] = useState<BlockTypeConfirmRequestPayload | null>(null);

  useEffect(() => {
    const loadCachedPayload = () => {
      void invoke<BlockTypeConfirmRequestPayload | null>("get_block_type_confirm_window_state").then((cachedPayload) => {
        if (cachedPayload) {
          setPayload(cachedPayload);
        }
      });
    };

    loadCachedPayload();

    void currentWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        loadCachedPayload();
      }
    });

    const unlisten = listen<BlockTypeConfirmRequestPayload>(BLOCK_TYPE_CONFIRM_REQUEST_EVENT, (event) => {
      setPayload(event.payload);
    });

    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [currentWindow]);

  useEffect(() => {
    if (payload) {
      return;
    }

    const timer = window.setInterval(() => {
      void invoke<BlockTypeConfirmRequestPayload | null>("get_block_type_confirm_window_state").then((cachedPayload) => {
      if (cachedPayload) {
        setPayload(cachedPayload);
      }
    });
    }, 100);

    return () => {
      window.clearInterval(timer);
    };
  }, [payload]);

  const respond = async (confirmed: boolean) => {
    if (!payload) {
      await currentWindow.hide();
      return;
    }

    await emitTo(payload.sourceWindowLabel, BLOCK_TYPE_CONFIRM_RESPONSE_EVENT, {
      requestId: payload.requestId,
      confirmed,
    });
    await currentWindow.hide();
  };

  useEffect(() => {
    const unlistenClose = currentWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await respond(false);
    });

    return () => {
      void unlistenClose.then((dispose) => dispose());
    };
  }, [currentWindow, payload]);

  if (!payload) {
    return <main className="dialog-window-root" />;
  }

  return (
    <main className="dialog-window-root">
      <section className="confirm-dialog-window">
        <header className="confirm-dialog-header">
          <div className="confirm-dialog-title">
            <strong>{payload.title}</strong>
            {payload.detail && <span>{payload.detail}</span>}
          </div>
        </header>
        <div className="confirm-dialog-body">{payload.message}</div>
        <div className="confirm-dialog-actions">
          <button type="button" className="toolbar-action" onClick={() => void respond(false)}>
            取消
          </button>
          <button type="button" className="toolbar-action primary" onClick={() => void respond(true)}>
            继续
          </button>
        </div>
      </section>
    </main>
  );
}
