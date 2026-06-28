import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import FolderOpenIcon from "../../images/folder_open.svg";
import FullscreenIcon from "../../images/fullscreen.svg";
import FullscreenExitIcon from "../../images/fullscreen_exit.svg";
import PauseIcon from "../../images/pause.svg";
import PlayIcon from "../../images/play.svg";
import SettingsRateIcon from "../../images/settings_rate.svg";
import VolumeOffIcon from "../../images/volume_off.svg";
import VolumeUpIcon from "../../images/volume_up.svg";
import {
  cacheResolvedMediaFile,
  forwardDriveNodeToChat,
  loadChatConversations,
  openLocalMediaFolder,
  postTypedChatMessage,
  reuploadCachedChatFile,
  resolveMediaAccess,
  validateLocalMediaFile,
} from "../features/chat/chatRepository";
import {
  fileContentJsonFromObject,
  fileObjectNotReusable,
} from "../features/chat/chatMessageUtils";
import type {
  ChatConversation,
  MediaViewerItem,
  MediaViewerOpenPayload,
  ResolvedMediaSource,
} from "../features/chat/types";
import {
  CHAT_LOCATE_MESSAGE_EVENT,
  MEDIA_VIEWER_OPEN_EVENT,
} from "../features/settings/windowEvents";

const CONTROL_HIDE_MS = 3000;
const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

const EMPTY_ACTIONS = {
  preview: false,
  download: false,
  forward: false,
  saveToPersonalDrive: false,
  saveToGroupDrive: false,
  openLocal: false,
  openContainingFolder: false,
  reupload: false,
};

const LOADING_MEDIA_SOURCE: ResolvedMediaSource = {
  status: "loading",
  sourceType: "none",
  allowedActions: EMPTY_ACTIONS,
  reasonText: "正在加载媒体...",
};

const LOCAL_ONLY_ACTIONS = {
  preview: true,
  download: false,
  forward: false,
  saveToPersonalDrive: false,
  saveToGroupDrive: false,
  openLocal: true,
  openContainingFolder: true,
  reupload: true,
};

function mediaDebug(label: string, payload: Record<string, unknown>): void {
  console.info(`[media-debug] ${label}`, payload);
  void invoke("media_debug_log", { label, payload }).catch(() => undefined);
}

export function MediaViewerWindowHost() {
  const [mediaList, setMediaList] = useState<MediaViewerItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const [openRevision, setOpenRevision] = useState(0);
  const [conversationTitle, setConversationTitle] = useState("");
  const [resolvedMap, setResolvedMap] = useState<Record<string, ResolvedMediaSource>>({});
  const [showControls, setShowControls] = useState(true);
  const [toolbarHover, setToolbarHover] = useState(false);
  const [visibleSideButton, setVisibleSideButton] = useState<"prev" | "next" | null>(null);
  const [statusText, setStatusText] = useState("");
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardConversations, setForwardConversations] = useState<ChatConversation[]>([]);
  const [forwardLoading, setForwardLoading] = useState(false);
  const [forwardError, setForwardError] = useState<string | null>(null);
  const [forwardSendingId, setForwardSendingId] = useState<string | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const lastOpenPayloadRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });

  const activeIndex = useMemo(
    () => Math.max(0, mediaList.findIndex((item) => item.id === activeId)),
    [activeId, mediaList],
  );
  const activeMedia = mediaList[activeIndex] ?? null;
  const activeResolved = activeMedia ? resolvedMap[activeMedia.id] : null;
  const activeUrl = activeResolved?.status === "ready" ? activeResolved.playableUrl || "" : "";
  const canPrev = activeIndex > 0;
  const canNext = activeIndex >= 0 && activeIndex < mediaList.length - 1;

  const applyOpenPayload = (payload: MediaViewerOpenPayload) => {
    mediaDebug("MediaViewer received payload", {
      activeId: payload.activeId,
      currentIndex: payload.currentIndex,
      mediaListLength: payload.mediaList.length,
      conversationId: payload.conversationId,
    });
    const nextMedia = payload.mediaList.filter(
      (item) => item.fileObjectId || item.localCandidates?.length,
    );
    const payloadKey = mediaViewerPayloadKey(payload, nextMedia);
    const now = Date.now();
    if (
      lastOpenPayloadRef.current.key === payloadKey &&
      now - lastOpenPayloadRef.current.at < 2_000
    ) {
      mediaDebug("MediaViewer duplicate payload ignored", {
        activeId: payload.activeId,
        currentIndex: payload.currentIndex,
        mediaListLength: nextMedia.length,
        conversationId: payload.conversationId,
      });
      revealControls();
      return;
    }
    lastOpenPayloadRef.current = { key: payloadKey, at: now };
    setMediaList(nextMedia);
    setConversationTitle(payload.conversationTitle || "");
    setActiveId(
      nextMedia.some((item) => item.id === payload.activeId)
        ? payload.activeId
        : nextMedia[payload.currentIndex]?.id ?? nextMedia[0]?.id ?? "",
    );
    setResolvedMap({});
    setOpenRevision((current) => current + 1);
    resetImageTransform();
    resetVideoState();
    setStatusText("");
    setForwardOpen(false);
    revealControls();
  };

  useEffect(() => {
    mediaDebug("MediaViewer host mounted", {
      href: window.location.href,
    });
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let unlistenFullscreen: (() => void) | null = null;
    let unlistenCloseRequested: (() => void) | null = null;
    let unlistenFocusChanged: (() => void) | null = null;
    async function bind() {
      const currentWindow = getCurrentWindow();
      invoke<MediaViewerOpenPayload | null>("get_media_viewer_open_payload")
        .then((payload) => {
          if (!disposed && payload) {
            applyOpenPayload(payload);
          }
        })
        .catch(() => undefined);
      unlisten = await listen<MediaViewerOpenPayload>(MEDIA_VIEWER_OPEN_EVENT, (event) => {
        if (disposed) {
          return;
        }
        applyOpenPayload(event.payload);
      });
      currentWindow.isFullscreen()
        .then((fullscreen) => {
          if (!disposed) {
            setIsFullscreen(fullscreen);
          }
        })
        .catch(() => undefined);
      unlistenFullscreen = await currentWindow.onResized(() => {
        currentWindow.isFullscreen()
          .then((fullscreen) => {
            if (!disposed) {
              setIsFullscreen(fullscreen);
            }
          })
          .catch(() => undefined);
      });
      unlistenCloseRequested = await currentWindow.onCloseRequested(() => {
        stopVideoPlayback();
      });
      unlistenFocusChanged = await currentWindow.onFocusChanged(({ payload }) => {
        if (!payload) {
          window.setTimeout(() => {
            currentWindow.isVisible()
              .then((visible) => {
                if (!visible) {
                  stopVideoPlayback();
                }
              })
              .catch(() => undefined);
          }, 80);
        }
      });
    }
    const handleDocumentVisibility = () => {
      if (document.hidden) {
        stopVideoPlayback();
      }
    };
    window.addEventListener("pagehide", stopVideoPlayback);
    document.addEventListener("visibilitychange", handleDocumentVisibility);
    void bind();
    return () => {
      disposed = true;
      stopVideoPlayback();
      unlisten?.();
      unlistenFullscreen?.();
      unlistenCloseRequested?.();
      unlistenFocusChanged?.();
      window.removeEventListener("pagehide", stopVideoPlayback);
      document.removeEventListener("visibilitychange", handleDocumentVisibility);
      clearHideTimer();
    };
  }, []);

  useEffect(() => {
    if (!activeMedia) {
      return;
    }
    resetImageTransform();
    resetVideoState();
    setStatusText("");
    revealControls();
    if (videoRef.current) {
      videoRef.current.pause();
    }
  }, [activeMedia?.id]);

  useEffect(() => {
    if (!activeMedia) {
      return;
    }
    if (activeResolved) {
      return;
    }
    let disposed = false;
    const media = activeMedia;
    setStatusText(activeMedia.type === "video" ? "正在准备视频..." : "正在加载图片...");
    setResolvedMap((current) => ({ ...current, [media.id]: LOADING_MEDIA_SOURCE }));
    void resolveMediaSource(media)
      .then((resolved) => {
        if (!disposed) {
          mediaDebug("MediaViewer resolve completed", {
            id: media.id,
            status: resolved.status,
            sourceType: resolved.sourceType,
            hasPlayableUrl: Boolean(resolved.playableUrl),
            allowedActions: resolved.allowedActions,
            reasonText: resolved.reasonText ?? null,
          });
          setResolvedMap((current) => ({ ...current, [media.id]: resolved }));
          setStatusText(resolved.status === "ready" ? "" : resolved.reasonText || mediaStatusText(resolved));
        }
      })
      .catch((error) => {
        if (!disposed) {
          mediaDebug("MediaViewer resolve failed", {
            id: media.id,
            error: String(error),
          });
          const failed = failedResolvedMediaSource(String(error));
          setResolvedMap((current) => ({ ...current, [media.id]: failed }));
          setStatusText(failed.reasonText || "媒体加载失败");
        }
      });
    return () => {
      disposed = true;
    };
  }, [activeMedia?.id, openRevision]);

  useEffect(() => {
    if (
      !activeMedia?.thumbnailObjectId ||
      !canUseCloudAccess(activeMedia) ||
      activeMedia.localCandidates?.length ||
      activeMedia.localPosterUrl ||
      resolvedMap[`${activeMedia.id}:poster`]
    ) {
      return;
    }
    let disposed = false;
    void cacheResolvedMediaFile({
      action: "preview",
      source: activeMedia.source,
      sourceId: activeMedia.sourceId,
      fileObjectId: activeMedia.thumbnailObjectId,
      fileName: `${activeMedia.fileName}.jpg`,
    })
      .then((result) => {
        if (!disposed) {
          setResolvedMap((current) => ({
            ...current,
            [`${activeMedia.id}:poster`]: {
              status: "ready",
              sourceType: "local_preview_cache",
              playableUrl: result.url,
              allowedActions: EMPTY_ACTIONS,
            },
          }));
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [activeMedia, resolvedMap]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (forwardOpen) {
        return;
      }
      if (event.key === "Escape") {
        void getCurrentWindow().close();
        return;
      }
      if (activeMedia?.type === "video") {
        if (event.key === " ") {
          event.preventDefault();
          togglePlay();
          return;
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          seekVideo(videoTime - 5);
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          seekVideo(videoTime + 5);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          updateVideoVolume(Math.min(1, volume + 0.05));
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          updateVideoVolume(Math.max(0, volume - 0.05));
          return;
        }
        if (event.key.toLowerCase() === "f") {
          event.preventDefault();
          void toggleFullscreen();
          return;
        }
        if (event.key.toLowerCase() === "m") {
          event.preventDefault();
          setMuted((current) => !current);
          return;
        }
      }
      if (event.key === "ArrowLeft") {
        selectByOffset(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        selectByOffset(1);
        return;
      }
      if (event.key.toLowerCase() === "f") {
        void toggleFullscreen();
        return;
      }
      if (event.key.toLowerCase() === "r" && activeMedia?.type === "image") {
        setRotation((current) => (current + 90) % 360);
        return;
      }
      if (event.ctrlKey && event.key === "0") {
        event.preventDefault();
        fitImage();
        return;
      }
      if (event.ctrlKey && event.key === "1") {
        event.preventDefault();
        setZoom(1);
        setPan({ x: 0, y: 0 });
        return;
      }
      if (event.ctrlKey && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        updateZoom(zoom + 0.2);
        return;
      }
      if (event.ctrlKey && event.key === "-") {
        event.preventDefault();
        updateZoom(zoom - 0.2);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeMedia, activeIndex, forwardOpen, mediaList, muted, volume, videoTime, zoom]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.volume = volume;
    video.muted = muted;
    video.playbackRate = speed;
  }, [activeMedia, muted, speed, volume]);

  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const revealControls = () => {
    clearHideTimer();
    setShowControls(true);
    hideTimerRef.current = window.setTimeout(() => {
      if (!toolbarHover) {
        setShowControls(false);
      }
    }, CONTROL_HIDE_MS);
  };

  const resetImageTransform = () => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  };

  const resetVideoState = () => {
    setVideoPlaying(false);
    setVideoTime(0);
    setVideoDuration(0);
  };

  const stopVideoPlayback = () => {
    const video = videoRef.current;
    if (video) {
      video.pause();
    }
    setVideoPlaying(false);
  };

  const selectByOffset = (offset: number) => {
    const nextIndex = activeIndex + offset;
    if (nextIndex < 0 || nextIndex >= mediaList.length) {
      return;
    }
    if (videoRef.current) {
      videoRef.current.pause();
    }
    setActiveId(mediaList[nextIndex].id);
  };

  const runWindowAction = (action: "minimize" | "toggleMaximize" | "close") => {
    const currentWindow = getCurrentWindow();
    if (action === "minimize") {
      stopVideoPlayback();
      void currentWindow.minimize();
      return;
    }
    if (action === "toggleMaximize") {
      void currentWindow.toggleMaximize();
      return;
    }
    stopVideoPlayback();
    void currentWindow.close();
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  };

  const seekVideo = (nextTime: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(nextTime)) {
      return;
    }
    video.currentTime = Math.max(0, Math.min(nextTime, video.duration || 0));
  };

  const updateVideoVolume = (nextVolume: number) => {
    const normalized = Math.max(0, Math.min(1, nextVolume));
    setVolume(normalized);
    setMuted(normalized <= 0);
  };

  const toggleFullscreen = async () => {
    try {
      const currentWindow = getCurrentWindow();
      const fullscreen = await currentWindow.isFullscreen().catch(() => isFullscreen);
      const nextFullscreen = !fullscreen;
      await currentWindow.setFullscreen(nextFullscreen);
      setIsFullscreen(nextFullscreen);
      revealControls();
    } catch (error) {
      mediaDebug("MediaViewer fullscreen failed", {
        error: String(error),
      });
      setStatusText("进入全屏失败");
    }
  };

  const updateZoom = (nextZoom: number) => {
    const value = Math.max(0.2, Math.min(5, nextZoom));
    setZoom(value);
    if (value <= 1) {
      setPan({ x: 0, y: 0 });
    }
  };

  const fitImage = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const downloadActiveMedia = async () => {
    if (!activeMedia) {
      return;
    }
    if (
      !activeMedia.fileObjectId ||
      !canUseCloudAccess(activeMedia) ||
      !activeResolved?.allowedActions.download
    ) {
      setStatusText("当前媒体暂无可下载文件");
      return;
    }
    setStatusText("正在下载...");
    try {
      const cloud = await resolveMediaAccess({
        action: "download",
        source: activeMedia.source,
        sourceId: activeMedia.sourceId,
        fileObjectId: activeMedia.fileObjectId,
      });
      if (cloud.status !== "allowed") {
        throw new Error(cloud.message || "当前文件不可下载");
      }
      const result = await invoke<{ path?: string; cancelled?: boolean }>(
        "download_chat_file",
        {
          fileObjectId: activeMedia.fileObjectId,
          fileName: activeMedia.fileName,
          source: activeMedia.source === "chat" ? "chat" : "drive",
          messageId: activeMedia.source === "chat" ? activeMedia.sourceId : null,
          driveNodeId: activeMedia.source === "chat" ? null : activeMedia.sourceId,
        },
      );
      setStatusText(result.cancelled ? "" : `已下载到 ${result.path}`);
    } catch (error) {
      setStatusText(String(error));
    }
  };

  const openActiveLocalFolder = async () => {
    if (!activeResolved?.playableUrl || !activeMedia) {
      return;
    }
    const localPath = localPathFromResolved(activeResolved, activeMedia);
    if (!localPath) {
      setStatusText("当前媒体没有可打开的本地文件夹");
      return;
    }
    try {
      await openLocalMediaFolder(localPath);
    } catch (error) {
      setStatusText(String(error));
    }
  };

  const forwardActiveMedia = async () => {
    if (!activeMedia?.fileObjectId || !activeResolved?.allowedActions.forward) {
      setStatusText("当前媒体缺少云端文件信息，暂不能转发");
      return;
    }
    setForwardOpen(true);
    setForwardLoading(true);
    setForwardError(null);
    setStatusText("");
    try {
      setForwardConversations(await loadChatConversations());
    } catch (error) {
      setForwardError(String(error));
    } finally {
      setForwardLoading(false);
    }
  };

  const forwardToConversation = async (conversation: ChatConversation) => {
    if (!activeMedia || forwardSendingId) {
      return;
    }
    setForwardSendingId(conversation.id);
    setForwardError(null);
    try {
      await forwardActiveMediaToConversation(activeMedia, conversation.id);
      setForwardOpen(false);
      setStatusText(`已转发给 ${conversation.title}`);
    } catch (error) {
      setForwardError(String(error));
    } finally {
      setForwardSendingId(null);
    }
  };

  const openSourceMessage = async () => {
    if (!activeMedia) {
      return;
    }
    await invoke("open_chat_window").catch(() => undefined);
    await emit(CHAT_LOCATE_MESSAGE_EVENT, {
      conversationId: activeMedia.conversationId,
      messageId: activeMedia.messageId,
      conversationSeq: activeMedia.seq ?? null,
    });
    setStatusText("已定位消息");
  };

  const handleStageMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    revealControls();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const hotWidth = Math.min(rect.width * 0.22, 220);
    if (mediaList.length <= 1) {
      setVisibleSideButton(null);
      return;
    }
    if (x <= hotWidth && canPrev) {
      setVisibleSideButton("prev");
    } else if (x >= rect.width - hotWidth && canNext) {
      setVisibleSideButton("next");
    } else {
      setVisibleSideButton(null);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (activeMedia?.type !== "image") {
      return;
    }
    event.preventDefault();
    updateZoom(zoom + (event.deltaY < 0 ? 0.12 : -0.12));
  };

  const startDrag = (event: PointerEvent<HTMLImageElement>) => {
    if (zoom <= 1) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
  };

  const dragImage = (event: PointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    setPan({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  };

  const stopDrag = (event: PointerEvent<HTMLImageElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {}
    }
  };

  const posterUrl = activeMedia
    ? activeMedia.localPosterUrl || resolvedMap[`${activeMedia.id}:poster`]?.playableUrl || ""
    : "";
  const rootClass = [
    "media-viewer-window",
    showControls ? "controls-visible" : "controls-hidden",
    activeMedia?.type === "video" && isFullscreen ? "is-video-fullscreen" : "",
    activeMedia?.type === "video" && !showControls ? "hide-cursor" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main
      className={rootClass}
      onMouseMove={revealControls}
      onClick={revealControls}
    >
      <header className={`media-viewer-titlebar ${showControls ? "" : "is-hidden"}`} data-tauri-drag-region>
        <div className="media-viewer-title" data-tauri-drag-region>
          <span data-tauri-drag-region>{conversationTitle || "媒体浏览"}</span>
          <strong data-tauri-drag-region>
            {activeMedia?.fileName || "媒体"}
            {mediaList.length > 1 ? ` · ${activeIndex + 1}/${mediaList.length}` : ""}
          </strong>
        </div>
        <div className="media-viewer-window-controls">
          <button type="button" title="最小化" onClick={() => runWindowAction("minimize")}>-</button>
          <button type="button" title="最大化" onClick={() => runWindowAction("toggleMaximize")}>□</button>
          <button type="button" className="close" title="关闭" onClick={() => runWindowAction("close")}>×</button>
        </div>
      </header>

      <section
        className="media-viewer-stage"
        onMouseMove={handleStageMouseMove}
        onMouseLeave={() => setVisibleSideButton(null)}
        onWheel={handleWheel}
        onDoubleClick={() => {
          if (activeMedia?.type === "image") {
            zoom === 1 ? updateZoom(2) : fitImage();
          } else {
            void toggleFullscreen();
          }
        }}
      >
        {mediaList.length > 1 ? (
          <>
            <div className={`media-viewer-hitbox is-prev ${visibleSideButton === "prev" ? "is-visible" : ""}`}>
              <button type="button" disabled={!canPrev} onClick={() => selectByOffset(-1)} aria-label="上一个">‹</button>
            </div>
            <div className={`media-viewer-hitbox is-next ${visibleSideButton === "next" ? "is-visible" : ""}`}>
              <button type="button" disabled={!canNext} onClick={() => selectByOffset(1)} aria-label="下一个">›</button>
            </div>
          </>
        ) : null}

        {!activeMedia ? (
          <div className="media-viewer-empty">暂无可浏览媒体</div>
        ) : activeMedia.type === "image" ? (
          activeUrl ? (
            <img
              className={`media-viewer-image ${zoom > 1 ? "is-draggable" : ""}`}
              src={activeUrl}
              alt={activeMedia.fileName}
              draggable={false}
              onPointerDown={startDrag}
              onPointerMove={dragImage}
              onPointerUp={stopDrag}
              onPointerCancel={stopDrag}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
              }}
            />
          ) : (
            <div className="media-viewer-empty">{statusText || "正在加载图片..."}</div>
          )
        ) : activeUrl ? (
          <video
            ref={videoRef}
            className="media-viewer-video"
            src={activeUrl}
            poster={posterUrl || undefined}
            playsInline
            preload="metadata"
            onPlay={() => setVideoPlaying(true)}
            onPause={() => setVideoPlaying(false)}
            onLoadedMetadata={(event) => {
              setVideoDuration(event.currentTarget.duration || activeMedia.duration || 0);
              event.currentTarget.volume = volume;
              event.currentTarget.muted = muted;
              event.currentTarget.playbackRate = speed;
            }}
            onTimeUpdate={(event) => setVideoTime(event.currentTarget.currentTime)}
            onEnded={() => setVideoPlaying(false)}
            onError={() => {
              setVideoPlaying(false);
              setStatusText("视频播放失败，可尝试下载后查看");
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (event.detail > 1) {
                return;
              }
              togglePlay();
            }}
          />
        ) : (
          <div className="media-viewer-empty">{statusText || "正在准备视频..."}</div>
        )}
      </section>

      <footer
        className={`media-viewer-toolbar ${
          activeMedia?.type === "video" ? "is-video" : "is-image"
        } ${showControls ? "" : "is-hidden"}`}
        onMouseEnter={() => {
          setToolbarHover(true);
          clearHideTimer();
          setShowControls(true);
        }}
        onMouseLeave={() => {
          setToolbarHover(false);
          revealControls();
        }}
      >
        {activeMedia?.type === "video" ? (
          <VideoToolbar
            playing={videoPlaying}
            currentTime={videoTime}
            duration={videoDuration || activeMedia.duration || 0}
            muted={muted}
            volume={volume}
            speed={speed}
            onTogglePlay={togglePlay}
            onSeek={seekVideo}
            onMutedChange={setMuted}
            onVolumeChange={setVolume}
            onSpeedChange={(next) => {
              setSpeed(next);
              if (videoRef.current) {
                videoRef.current.playbackRate = next;
              }
            }}
            fullscreen={isFullscreen}
            canOpenLocalFolder={Boolean(activeResolved?.allowedActions.openContainingFolder)}
            onFullscreen={() => void toggleFullscreen()}
            onOpenFileLocation={() => void openActiveLocalFolder()}
          />
        ) : (
          <>
            <ImageToolbar
              zoom={zoom}
              onZoomOut={() => updateZoom(zoom - 0.2)}
              onZoomIn={() => updateZoom(zoom + 0.2)}
              onActualSize={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              onFit={fitImage}
              onRotateLeft={() => setRotation((current) => (current + 270) % 360)}
              onRotateRight={() => setRotation((current) => (current + 90) % 360)}
            />
            <span className="media-viewer-divider" />
            {activeResolved?.allowedActions.download ? (
              <button type="button" onClick={() => void downloadActiveMedia()}>下载</button>
            ) : null}
            {activeResolved?.allowedActions.forward ? (
              <button type="button" onClick={() => void forwardActiveMedia()}>转发</button>
            ) : null}
            {activeResolved?.allowedActions.openContainingFolder ? (
              <button type="button" onClick={() => void openActiveLocalFolder()}>所在文件夹</button>
            ) : null}
            <button type="button" onClick={() => void openSourceMessage()}>所在消息</button>
          </>
        )}
      </footer>

      {statusText ? <div className="media-viewer-status">{statusText}</div> : null}
      {forwardOpen ? (
        <MediaForwardPicker
          conversations={forwardConversations}
          loading={forwardLoading}
          error={forwardError}
          sendingId={forwardSendingId}
          onClose={() => {
            if (!forwardSendingId) {
              setForwardOpen(false);
            }
          }}
          onSelect={(conversation) => void forwardToConversation(conversation)}
        />
      ) : null}
    </main>
  );
}

function ImageToolbar({
  zoom,
  onZoomOut,
  onZoomIn,
  onActualSize,
  onFit,
  onRotateLeft,
  onRotateRight,
}: {
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onActualSize: () => void;
  onFit: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
}) {
  return (
    <>
      <button type="button" onClick={onZoomOut}>-</button>
      <span className="media-viewer-zoom">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={onZoomIn}>+</button>
      <button type="button" onClick={onActualSize}>1:1</button>
      <button type="button" onClick={onFit}>适应</button>
      <button type="button" onClick={onRotateLeft}>左旋</button>
      <button type="button" onClick={onRotateRight}>右旋</button>
    </>
  );
}

function VideoToolbar({
  playing,
  currentTime,
  duration,
  muted,
  volume,
  speed,
  fullscreen,
  canOpenLocalFolder,
  onTogglePlay,
  onSeek,
  onMutedChange,
  onVolumeChange,
  onSpeedChange,
  onFullscreen,
  onOpenFileLocation,
}: {
  playing: boolean;
  currentTime: number;
  duration: number;
  muted: boolean;
  volume: number;
  speed: number;
  fullscreen: boolean;
  canOpenLocalFolder: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onMutedChange: (muted: boolean) => void;
  onVolumeChange: (volume: number) => void;
  onSpeedChange: (speed: number) => void;
  onFullscreen: () => void;
  onOpenFileLocation: () => void;
}) {
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPercent, setHoverPercent] = useState(0);
  const progressMax = Math.max(0, duration);
  const progressValue = Math.min(currentTime, duration || currentTime);
  const progressPercent = progressMax > 0 ? (progressValue / progressMax) * 100 : 0;
  const volumeValue = muted ? 0 : volume;
  const volumePercent = Math.max(0, Math.min(100, volumeValue * 100));
  const speedLabel = formatPlaybackSpeed(speed);
  const updateHoverTime = (event: MouseEvent<HTMLInputElement>) => {
    if (progressMax <= 0) {
      setHoverTime(null);
      setHoverPercent(0);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setHoverPercent(ratio * 100);
    setHoverTime(progressMax * ratio);
  };

  return (
    <div className="video-control-bar">
      <div className="video-control-left">
        <VideoIconButton
          icon={playing ? PauseIcon : PlayIcon}
          label={playing ? "暂停" : "播放"}
          onClick={onTogglePlay}
          emphasized
        />
        <span className="video-time-readout">
          {formatMediaTime(currentTime)} / {formatMediaTime(duration)}
        </span>
      </div>

      <div className="video-progress-shell">
        <div
          className="video-progress-track"
          style={{ "--video-progress-value": `${progressPercent}%` } as CSSProperties}
        >
          <input
            className="video-progress-input"
            type="range"
            min={0}
            max={progressMax}
            step={0.1}
            value={progressValue}
            aria-label="播放进度"
            title={hoverTime === null ? "播放进度" : formatMediaTime(hoverTime)}
            onMouseMove={updateHoverTime}
            onMouseEnter={updateHoverTime}
            onMouseLeave={() => setHoverTime(null)}
            onChange={(event) => onSeek(Number(event.currentTarget.value))}
          />
          {hoverTime !== null ? (
            <span
              className="video-progress-tooltip"
              style={{ left: `${hoverPercent}%` }}
            >
              {formatMediaTime(hoverTime)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="video-control-right">
        <div
          className="video-volume-control"
          style={{ "--video-volume-value": `${volumePercent}%` } as CSSProperties}
        >
          <VideoIconButton
            icon={muted || volume <= 0 ? VolumeOffIcon : VolumeUpIcon}
            label={muted || volume <= 0 ? "取消静音" : "静音"}
            onClick={() => onMutedChange(!muted)}
          />
          <span className="video-volume-track">
            <input
              className="video-volume-input"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volumeValue}
              aria-label="音量"
              title={muted || volume <= 0 ? "取消静音" : "静音"}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                onVolumeChange(next);
                onMutedChange(next <= 0);
              }}
            />
          </span>
        </div>

        <div className="video-speed-control">
          <button
            type="button"
            className={`video-speed-button ${speedMenuOpen ? "is-active" : ""}`}
            title="播放速度"
            aria-label="播放速度"
            aria-haspopup="menu"
            aria-expanded={speedMenuOpen}
            onClick={() => setSpeedMenuOpen((current) => !current)}
            onBlur={(event) => {
              if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) {
                setSpeedMenuOpen(false);
              }
            }}
          >
            <img src={SettingsRateIcon} alt="" aria-hidden="true" />
            <span>{speedLabel}</span>
          </button>
          {speedMenuOpen ? (
            <div className="video-speed-menu" role="menu">
              {SPEEDS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={item === speed ? "is-selected" : ""}
                  role="menuitemradio"
                  aria-checked={item === speed}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onSpeedChange(item);
                    setSpeedMenuOpen(false);
                  }}
                >
                  {formatPlaybackSpeed(item)}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <VideoIconButton
          icon={fullscreen ? FullscreenExitIcon : FullscreenIcon}
          label={fullscreen ? "退出全屏" : "全屏"}
          onClick={onFullscreen}
        />
        <VideoIconButton
          icon={FolderOpenIcon}
          label="打开文件位置"
          onClick={onOpenFileLocation}
          disabled={!canOpenLocalFolder}
        />
      </div>
    </div>
  );
}

function VideoIconButton({
  icon,
  label,
  onClick,
  disabled = false,
  emphasized = false,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  emphasized?: boolean;
}) {
  return (
    <button
      type="button"
      className={`video-icon-button ${emphasized ? "is-emphasized" : ""}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <img src={icon} alt="" aria-hidden="true" />
    </button>
  );
}

function MediaForwardPicker({
  conversations,
  loading,
  error,
  sendingId,
  onClose,
  onSelect,
}: {
  conversations: ChatConversation[];
  loading: boolean;
  error?: string | null;
  sendingId?: string | null;
  onClose: () => void;
  onSelect: (conversation: ChatConversation) => void;
}) {
  return (
    <div className="chat-modal-backdrop image-preview-forward-backdrop" onClick={onClose}>
      <section className="forward-picker image-preview-forward-picker" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>转发给</h2>
          <p>{loading ? "正在加载会话" : "选择一个会话"}</p>
        </header>
        <div className="forward-picker-list">
          {error ? <p className="forward-picker-empty is-error">{error}</p> : null}
          {loading && conversations.length === 0 ? (
            <p className="forward-picker-empty">正在加载会话...</p>
          ) : conversations.length > 0 ? (
            conversations.map((conversation) => {
              const avatarUrl = conversation.participant.avatarUrl;
              const avatarLabel = conversation.participant.avatar || conversation.title.slice(0, 1);
              const isSending = sendingId === conversation.id;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  disabled={Boolean(sendingId)}
                  onClick={() => onSelect(conversation)}
                >
                  <span className={`image-preview-forward-avatar tone-${conversation.kind}`}>
                    {avatarUrl ? <img src={avatarUrl} alt="" /> : avatarLabel}
                  </span>
                  <span>
                    <strong>{conversation.title}</strong>
                    <em>{isSending ? "正在转发..." : conversation.subtitle}</em>
                  </span>
                </button>
              );
            })
          ) : (
            <p className="forward-picker-empty">暂无可转发会话</p>
          )}
        </div>
        <footer>
          <button type="button" disabled={Boolean(sendingId)} onClick={onClose}>取消</button>
        </footer>
      </section>
    </div>
  );
}

function mediaViewerPayloadKey(
  payload: MediaViewerOpenPayload,
  mediaList: MediaViewerItem[],
): string {
  return JSON.stringify({
    conversationId: payload.conversationId,
    activeId: payload.activeId,
    currentIndex: payload.currentIndex,
    items: mediaList.map((item) => ({
      id: item.id,
      source: item.source,
      sourceId: item.sourceId,
      fileObjectId: item.fileObjectId ?? null,
      messageFileRefId: item.messageFileRefId ?? null,
      localCandidates: (item.localCandidates ?? []).map((candidate) => ({
        path: candidate.path,
        sourceType: candidate.sourceType ?? null,
      })),
    })),
  });
}

async function resolveMediaSource(media: MediaViewerItem): Promise<ResolvedMediaSource> {
  const startedAt = performance.now();
  mediaDebug("resolveMediaSource start", {
    id: media.id,
    type: media.type,
    source: media.source,
    sourceId: media.sourceId,
    messageFileRefId: media.messageFileRefId,
    fileObjectId: media.fileObjectId,
    localCandidates: media.localCandidates,
  });
  const local = await resolveLocalMediaSource(media);
  if (local) {
    mediaDebug("resolveMediaSource local hit, skip cloud", {
      id: media.id,
      sourceType: local.sourceType,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return local;
  }

  if (media.source === "local_pending") {
    mediaDebug("resolveMediaSource local_pending without local file", {
      id: media.id,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return {
      status: "not_uploaded",
      sourceType: "none",
      allowedActions: EMPTY_ACTIONS,
      reasonText: "文件仍在上传中，只能在发送设备本地预览",
    };
  }

  if (!media.fileObjectId) {
    mediaDebug("resolveMediaSource missing fileObjectId", {
      id: media.id,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return failedResolvedMediaSource("当前媒体缺少云端文件信息");
  }

  const accessStartedAt = performance.now();
  mediaDebug("resolveMediaAccess request", {
    action: "preview",
    source: media.source,
    sourceId: media.sourceId,
    fileObjectId: media.fileObjectId,
  });
  const cloud = await resolveMediaAccess({
    action: "preview",
    source: media.source,
    sourceId: media.sourceId,
    fileObjectId: media.fileObjectId,
  });
  mediaDebug("resolveMediaAccess response", {
    status: cloud.status,
    message: cloud.message ?? null,
    hasUrl: Boolean(cloud.url),
    elapsedMs: Math.round(performance.now() - accessStartedAt),
  });
  if (cloud.status !== "allowed") {
    mediaDebug("resolveMediaSource denied", {
      id: media.id,
      status: cloud.status,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return {
      status: normalizeResolvedStatus(cloud.status),
      sourceType: "none",
      allowedActions: EMPTY_ACTIONS,
      reasonText: cloud.message || cloudDeniedText(cloud.status),
      fallback: cloud.fallback ?? null,
    };
  }

  const cacheStartedAt = performance.now();
  mediaDebug("cacheResolvedMediaFile request", {
    action: "preview",
    source: media.source,
    sourceId: media.sourceId,
    fileObjectId: media.fileObjectId,
    fileName: media.fileName,
  });
  const cached = await cacheResolvedMediaFile({
    action: "preview",
    source: media.source,
    sourceId: media.sourceId,
    fileObjectId: media.fileObjectId,
    fileName: media.fileName,
  });
  mediaDebug("cacheResolvedMediaFile response", {
    path: cached.path,
    elapsedMs: Math.round(performance.now() - cacheStartedAt),
    totalElapsedMs: Math.round(performance.now() - startedAt),
  });
  return {
    status: "ready",
    sourceType: "local_preview_cache",
    playableUrl: cached.url,
    localPath: cached.path,
    expiresAt: cloud.urlExpiresAt ?? null,
    allowedActions: cloud.allowedActions,
    fallback: cloud.fallback ?? null,
  };
}

async function resolveLocalMediaSource(media: MediaViewerItem): Promise<ResolvedMediaSource | null> {
  for (const candidate of media.localCandidates ?? []) {
    const startedAt = performance.now();
    mediaDebug("validateLocalMediaFile start", {
      id: media.id,
      path: candidate.path,
      sourceType: candidate.sourceType ?? null,
    });
    try {
      const url = await validateLocalMediaFile(candidate.path);
      mediaDebug("validateLocalMediaFile success", {
        id: media.id,
        path: candidate.path,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      return {
        status: "ready",
        sourceType:
          candidate.sourceType === "local_download" ||
          candidate.sourceType === "local_preview_cache" ||
          candidate.sourceType === "local_original"
            ? candidate.sourceType
            : "local_original",
        playableUrl: url,
        localPath: candidate.path,
        allowedActions: LOCAL_ONLY_ACTIONS,
      };
    } catch (error) {
      mediaDebug("validateLocalMediaFile failed", {
        id: media.id,
        path: candidate.path,
        error: String(error),
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      // Try the next candidate; local paths can legitimately disappear.
    }
  }
  return null;
}

function failedResolvedMediaSource(message: string): ResolvedMediaSource {
  return {
    status: "failed",
    sourceType: "none",
    allowedActions: EMPTY_ACTIONS,
    reasonText: message || "媒体加载失败",
  };
}

function mediaStatusText(resolved: ResolvedMediaSource): string {
  return resolved.reasonText || cloudDeniedText(resolved.status);
}

function normalizeResolvedStatus(status: string): ResolvedMediaSource["status"] {
  if (
    status === "expired" ||
    status === "no_permission" ||
    status === "deleted" ||
    status === "blocked" ||
    status === "not_uploaded"
  ) {
    return status;
  }
  return "failed";
}

function cloudDeniedText(status: string): string {
  if (status === "expired") {
    return "文件已过期，无法播放或下载";
  }
  if (status === "no_permission") {
    return "无权访问该文件";
  }
  if (status === "deleted") {
    return "文件不可查看或已被删除";
  }
  if (status === "blocked") {
    return "文件被安全策略拦截";
  }
  if (status === "not_uploaded") {
    return "文件仍在上传中";
  }
  return "媒体加载失败";
}

function canUseCloudAccess(media: MediaViewerItem): media is MediaViewerItem & {
  source: "chat" | "personal_drive" | "group_drive";
  fileObjectId: string;
} {
  return media.source !== "local_pending" && Boolean(media.fileObjectId && media.sourceId);
}

function localPathFromResolved(
  resolved: ResolvedMediaSource,
  media: MediaViewerItem,
): string | null {
  if (
    resolved.sourceType !== "local_original" &&
    resolved.sourceType !== "local_download" &&
    resolved.sourceType !== "local_preview_cache"
  ) {
    return null;
  }
  if (resolved.localPath) {
    return resolved.localPath;
  }
  const candidate = (media.localCandidates ?? []).find(
    (item) => item.sourceType === resolved.sourceType,
  );
  return candidate?.path ?? media.localCandidates?.[0]?.path ?? null;
}

async function forwardActiveMediaToConversation(
  media: MediaViewerItem,
  conversationId: string,
) {
  if (media.source === "personal_drive" || media.source === "group_drive") {
    if (media.fileObjectId) {
      const access = await resolveMediaAccess({
        action: "forward",
        source: media.source,
        sourceId: media.sourceId,
        fileObjectId: media.fileObjectId,
      });
      if (access.status !== "allowed" || !access.allowedActions.forward) {
        throw new Error(access.message || "当前媒体暂不能转发");
      }
    }
    await forwardDriveNodeToChat(media.sourceId, conversationId);
    return;
  }
  const messageType = media.type;
  const content = media.type === "image" ? "[图片]" : "[视频]";
  const fileType = media.type;
  const contentType = media.type === "image" ? "image/jpeg" : "video/mp4";
  if (media.fileObjectId) {
    if (canUseCloudAccess(media)) {
      const access = await resolveMediaAccess({
        action: "forward",
        source: media.source,
        sourceId: media.sourceId,
        fileObjectId: media.fileObjectId,
      });
      if (access.status !== "allowed" || !access.allowedActions.forward) {
        throw new Error(access.message || "当前媒体暂不能转发");
      }
    }
    try {
      await postTypedChatMessage({
        conversationId,
        messageType,
        content,
        contentJson: {
          fileId: media.fileObjectId,
          fileObjectId: media.fileObjectId,
          fileName: media.fileName,
          sizeBytes: media.fileSize ?? 0,
          contentType,
          fileType,
          url: null,
          thumbnailObjectId: media.thumbnailObjectId ?? null,
          sourceMessageId: media.sourceMessageId ?? media.messageId,
          sourceType: "forward",
        },
        fileObjectId: media.fileObjectId,
      });
      return;
    } catch (error) {
      if (!fileObjectNotReusable(error)) {
        throw error;
      }
    }
    const uploaded = await reuploadCachedChatFile({
      fileObjectId: media.fileObjectId,
      fileName: media.fileName,
      contentType,
      fileType,
    });
    await postTypedChatMessage({
      conversationId,
      messageType,
      content,
      contentJson: fileContentJsonFromObject(uploaded, media.fileName),
      fileObjectId: uploaded.id,
    });
    return;
  }
  throw new Error("当前媒体缺少云端文件信息，暂不能转发");
}

function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "00:00";
  }
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatPlaybackSpeed(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : String(value)}x`;
}
