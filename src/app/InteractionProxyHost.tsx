import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef } from "react";
import {
  PROXY_HITBOXES_EVENT,
  PROXY_TRIGGER_EVENT,
  WIDGET_LABEL,
} from "../features/windowMode/proxyEvents";
import type { ProxyHitboxProbe, ProxyHitboxResult, ProxyWidgetHit } from "../features/windowMode/types";

type RectHitbox = {
  kind: ProxyWidgetHit["kind"];
  id?: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function InteractionProxyHost() {
  const proxyWindow = useMemo(() => getCurrentWindow(), []);
  const hitboxesRef = useRef<RectHitbox[]>([]);
  const canInteractRef = useRef(false);

  useEffect(() => {
    void proxyWindow.setIgnoreCursorEvents(true);

    const unlistenHitboxes = listen<RectHitbox[]>(PROXY_HITBOXES_EVENT, (event) => {
      hitboxesRef.current = event.payload;
    });

    return () => {
      void unlistenHitboxes.then((unlisten) => unlisten());
    };
  }, [proxyWindow]);

  const probeInteraction = async (event: React.PointerEvent<HTMLElement>) => {
    const widgetHit = findWidgetHit(hitboxesRef.current, event.clientX, event.clientY);
    const result = await invoke<ProxyHitboxResult>("proxy_hitbox_probe", {
      probe: {
        screenX: Math.round(event.screenX),
        screenY: Math.round(event.screenY),
        localX: event.clientX,
        localY: event.clientY,
        widgetHit,
      } satisfies ProxyHitboxProbe,
    });

    canInteractRef.current = result.canInteract;
  };

  const triggerInteraction = async (event: React.PointerEvent<HTMLElement>) => {
    const widgetHit = findWidgetHit(hitboxesRef.current, event.clientX, event.clientY);
    const result = await invoke<ProxyHitboxResult>("proxy_hitbox_probe", {
      probe: {
        screenX: Math.round(event.screenX),
        screenY: Math.round(event.screenY),
        localX: event.clientX,
        localY: event.clientY,
        widgetHit,
      } satisfies ProxyHitboxProbe,
    });

    if (result.canInteract && result.widgetHit) {
      await emitTo(WIDGET_LABEL, PROXY_TRIGGER_EVENT, result.widgetHit);
    }

    canInteractRef.current = false;
    await invoke("set_proxy_passthrough", { passthrough: true });
  };

  const releaseInteraction = async () => {
    if (!canInteractRef.current) {
      return;
    }

    canInteractRef.current = false;
    await invoke("set_proxy_passthrough", { passthrough: true });
  };

  return (
    <main
      className="interaction-proxy-root"
      onPointerMove={probeInteraction}
      onPointerDown={triggerInteraction}
      onPointerLeave={releaseInteraction}
    />
  );
}

function findWidgetHit(hitboxes: RectHitbox[], x: number, y: number): ProxyWidgetHit | null {
  for (const hitbox of hitboxes) {
    if (x < hitbox.left || x > hitbox.right || y < hitbox.top || y > hitbox.bottom) {
      continue;
    }

    if (hitbox.kind === "menu-button") {
      return { kind: "menu-button", id: hitbox.id };
    }

    if (!hitbox.id) {
      return null;
    }

    return { kind: hitbox.kind, id: hitbox.id } as ProxyWidgetHit;
  }

  return null;
}
