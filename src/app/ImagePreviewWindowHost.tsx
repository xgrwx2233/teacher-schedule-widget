import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent, PointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cacheChatFile,
  downloadChatFile,
  loadChatConversations,
  postTypedChatMessage,
  reuploadCachedChatFile,
  uploadChatFileBytes,
} from "../features/chat/chatRepository";
import {
  blobToBytes,
  extensionFromContentType,
  fileContentJsonFromObject,
  fileObjectNotReusable,
  filenameWithExtension,
} from "../features/chat/chatMessageUtils";
import type {
  ChatConversation,
  ImagePreviewItem,
  ImagePreviewOpenPayload,
} from "../features/chat/types";
import { IMAGE_PREVIEW_OPEN_EVENT } from "../features/settings/windowEvents";

function imageAccessSource(image: ImagePreviewItem) {
  return image.sourceMessageId
    && image.sourceMessageId.startsWith("msg_")
    ? { source: "chat" as const, messageId: image.sourceMessageId }
    : undefined;
}

export function ImagePreviewWindowHost() {
  const [images, setImages] = useState<ImagePreviewItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const [urlMap, setUrlMap] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [visibleSideButton, setVisibleSideButton] = useState<"prev" | "next" | null>(
    null,
  );
  const [statusText, setStatusText] = useState("");
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardConversations, setForwardConversations] = useState<
    ChatConversation[]
  >([]);
  const [forwardLoading, setForwardLoading] = useState(false);
  const [forwardError, setForwardError] = useState<string | null>(null);
  const [forwardSendingId, setForwardSendingId] = useState<string | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const activeIndex = useMemo(
    () => Math.max(0, images.findIndex((image) => image.id === activeId)),
    [activeId, images],
  );
  const activeImage = images[activeIndex] ?? null;
  const activeUrl = activeImage
    ? urlMap[activeImage.id] || activeImage.url || ""
    : "";

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    async function bind() {
      unlisten = await listen<ImagePreviewOpenPayload>(
        IMAGE_PREVIEW_OPEN_EVENT,
        (event) => {
          if (disposed) {
            return;
          }
          const nextImages = event.payload.images.filter(
            (image) => image.url || image.fileObjectId,
          );
          setImages(nextImages);
          setActiveId(
            nextImages.some((image) => image.id === event.payload.activeId)
              ? event.payload.activeId
              : nextImages[0]?.id ?? "",
          );
          setZoom(1);
          setRotation(0);
          setPan({ x: 0, y: 0 });
          setStatusText("");
          setForwardOpen(false);
          setForwardError(null);
          setForwardSendingId(null);
        },
      );
    }
    void bind();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!activeImage || urlMap[activeImage.id]) {
      return;
    }
    if (!activeImage.fileObjectId) {
      return;
    }
    let disposed = false;
    void cacheChatFile(
      activeImage.fileObjectId,
      activeImage.fileName || "图片",
      imageAccessSource(activeImage),
    )
      .then((url) => {
        if (!disposed) {
          setUrlMap((current) => ({ ...current, [activeImage.id]: url }));
        }
      })
      .catch(() => {
        if (!disposed) {
          setStatusText("图片加载失败");
        }
      });
    return () => {
      disposed = true;
    };
  }, [activeImage, urlMap]);

  const selectByOffset = (offset: number) => {
    if (images.length <= 1) {
      return;
    }
    const nextIndex = (activeIndex + offset + images.length) % images.length;
    setActiveId(images[nextIndex].id);
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
    setStatusText("");
  };

  const runWindowAction = (action: "minimize" | "toggleMaximize" | "close") => {
    const currentWindow = getCurrentWindow();
    if (action === "minimize") {
      void currentWindow.minimize();
      return;
    }
    if (action === "toggleMaximize") {
      void currentWindow.toggleMaximize();
      return;
    }
    void currentWindow.close();
  };

  const downloadActiveImage = async () => {
    if (!activeImage?.fileObjectId) {
      setStatusText("当前图片暂无可下载文件");
      return;
    }
    setStatusText("正在下载...");
    try {
      const result = await downloadChatFile(
        activeImage.fileObjectId,
        activeImage.fileName || "图片",
        imageAccessSource(activeImage),
      );
      if (result.cancelled) {
        setStatusText("");
        return;
      }
      setStatusText(`已下载到 ${result.path}`);
    } catch (error) {
      setStatusText(String(error));
    }
  };

  const forwardActiveImage = async () => {
    if (!activeImage?.fileObjectId) {
      setStatusText("当前图片缺少云端文件信息，不能转发");
      return;
    }
    setForwardOpen(true);
    setForwardLoading(true);
    setForwardError(null);
    setStatusText("");
    void getCurrentWindow().setFocus();
    try {
      setForwardConversations(await loadChatConversations());
    } catch (error) {
      setForwardError(String(error));
    } finally {
      setForwardLoading(false);
    }
  };

  const forwardToConversation = async (conversation: ChatConversation) => {
    if (!activeImage?.fileObjectId || forwardSendingId) {
      return;
    }
    setForwardSendingId(conversation.id);
    setForwardError(null);
    try {
      await forwardActiveImageToConversation(activeImage, conversation.id);
      setForwardOpen(false);
      setStatusText(`???? ${conversation.title}`);
    } catch (error) {
      setForwardError(String(error));
    } finally {
      setForwardSendingId(null);
    }
  };

  const updateZoom = (nextZoom: number) => {
    setZoom(nextZoom);
    if (nextZoom <= 1) {
      setPan({ x: 0, y: 0 });
    }
  };

  const resetImageTransform = () => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  };

  const handleStageMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const hotWidth = Math.min(rect.width * 0.22, 220);
    if (images.length <= 1) {
      setVisibleSideButton(null);
      return;
    }
    if (x <= hotWidth) {
      setVisibleSideButton("prev");
    } else if (x >= rect.width - hotWidth) {
      setVisibleSideButton("next");
    } else {
      setVisibleSideButton(null);
    }
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

  return (
    <main className="image-preview-window">
      <header className="image-preview-titlebar" data-tauri-drag-region>
        <div className="image-preview-title" data-tauri-drag-region>
          <span data-tauri-drag-region>{activeImage?.fileName || "图片预览"}</span>
          {images.length > 1 ? (
            <strong data-tauri-drag-region>
              {activeIndex + 1}/{images.length}
            </strong>
          ) : null}
        </div>
        <div className="image-preview-window-controls">
          <button
            type="button"
            title="最小化"
            onClick={() => runWindowAction("minimize")}
          >
            -
          </button>
          <button
            type="button"
            title="最大化"
            onClick={() => runWindowAction("toggleMaximize")}
          >
            □
          </button>
          <button
            type="button"
            className="close"
            title="关闭"
            onClick={() => runWindowAction("close")}
          >
            ×
          </button>
        </div>
      </header>

      <div
        className="image-preview-stage"
        onMouseMove={handleStageMouseMove}
        onMouseLeave={() => setVisibleSideButton(null)}
      >
        {images.length > 1 ? (
          <>
            <div
              className={`image-preview-side-hotzone is-prev ${
                visibleSideButton === "prev" ? "is-visible" : ""
              }`}
            >
              <button
                type="button"
                className="image-preview-side-button"
                title="上一张"
                onClick={() => selectByOffset(-1)}
              >
                ‹
              </button>
            </div>
            <div
              className={`image-preview-side-hotzone is-next ${
                visibleSideButton === "next" ? "is-visible" : ""
              }`}
            >
              <button
                type="button"
                className="image-preview-side-button"
                title="下一张"
                onClick={() => selectByOffset(1)}
              >
                ›
              </button>
            </div>
          </>
        ) : null}
        {activeUrl ? (
          <img
            src={activeUrl}
            alt={activeImage?.fileName || "图片"}
            className={zoom > 1 ? "is-draggable" : ""}
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
          <div className="image-preview-empty">{statusText || "正在加载图片"}</div>
        )}
      </div>

      <footer className="image-preview-toolbar">
        <button
          type="button"
          title="放大"
          onClick={() => updateZoom(Math.min(4, zoom + 0.2))}
        >
          +
        </button>
        <button
          type="button"
          title="缩小"
          onClick={() => updateZoom(Math.max(0.2, zoom - 0.2))}
        >
          -
        </button>
        <button
          type="button"
          title="原始大小"
          onClick={resetImageTransform}
        >
          1:1
        </button>
        <button
          type="button"
          title="旋转"
          onClick={() => setRotation((current) => (current + 90) % 360)}
        >
          ↻
        </button>
        <span className="image-preview-divider" />
        <button type="button" title="下载" onClick={() => void downloadActiveImage()}>
          下载
        </button>
        <button
          type="button"
          title="转发"
          onClick={() => void forwardActiveImage()}
        >
          转发
        </button>
      </footer>
      {statusText ? <div className="image-preview-status">{statusText}</div> : null}
      {forwardOpen ? (
        <ImagePreviewForwardPicker
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

function ImagePreviewForwardPicker({
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
    <div
      className="chat-modal-backdrop image-preview-forward-backdrop"
      onClick={onClose}
    >
      <section
        className="forward-picker image-preview-forward-picker"
        onClick={(event) => event.stopPropagation()}
      >
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
              const avatarLabel =
                conversation.participant.avatar || conversation.title.slice(0, 1);
              const isSending = sendingId === conversation.id;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  disabled={Boolean(sendingId)}
                  onClick={() => onSelect(conversation)}
                >
                  <span
                    className={`image-preview-forward-avatar tone-${conversation.kind}`}
                  >
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
          <button type="button" disabled={Boolean(sendingId)} onClick={onClose}>
            取消
          </button>
        </footer>
      </section>
    </div>
  );
}

async function forwardActiveImageToConversation(
  image: ImagePreviewItem,
  conversationId: string,
) {
  const fileName = image.fileName || "图片";
  if (image.fileObjectId) {
    try {
      await postTypedChatMessage({
        conversationId,
        messageType: "image",
        content: "[图片]",
        contentJson: {
          fileId: image.fileObjectId,
          fileObjectId: image.fileObjectId,
          fileName,
          contentType: "image/jpeg",
          url: null,
        },
        fileObjectId: image.fileObjectId,
      });
      return;
    } catch (error) {
      if (!fileObjectNotReusable(error)) {
        throw error;
      }
    }
    try {
      const uploaded = await reuploadCachedChatFile({
        fileObjectId: image.fileObjectId,
        fileName,
        contentType: "image/jpeg",
        fileType: "image",
      });
      await postTypedChatMessage({
        conversationId,
        messageType: "image",
        content: "[图片]",
        contentJson: fileContentJsonFromObject(uploaded, fileName),
        fileObjectId: uploaded.id,
      });
      return;
    } catch {
      // Fall back to the preview URL if this image came from an older local cache.
    }
  }

  const sourceUrl = image.fileObjectId
    ? await cacheChatFile(image.fileObjectId, fileName, imageAccessSource(image))
    : image.url;
  if (!sourceUrl) {
    throw new Error("当前图片缺少文件信息，暂不能转发");
  }
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`读取图片失败: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const contentType = blob.type || "image/jpeg";
  const uploaded = await uploadChatFileBytes({
    filename: filenameWithExtension(
      fileName,
      extensionFromContentType(contentType, "jpg"),
    ),
    contentType,
    bytes: await blobToBytes(blob),
    fileType: "image",
  });
  await postTypedChatMessage({
    conversationId,
    messageType: "image",
    content: "[图片]",
    contentJson: fileContentJsonFromObject(uploaded, fileName),
    fileObjectId: uploaded.id,
  });
}
