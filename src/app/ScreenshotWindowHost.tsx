import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CSSProperties, PointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SCREENSHOT_OPEN_EVENT } from "../features/settings/windowEvents";

const SCREENSHOT_OPEN_START_EVENT = "screenshot-open-start";
const SCREENSHOT_OPEN_ERROR_EVENT = "screenshot-open-error";

type ScreenshotCapturePayload = {
  imagePath: string;
  width: number;
  height: number;
  screenLeft: number;
  screenTop: number;
};

type ScreenshotOpenPayload = {
  capture: ScreenshotCapturePayload;
  hiddenChatWindow?: boolean;
};

type ScreenshotOpenErrorPayload = {
  message: string;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

type Tool = "shape" | "arrow" | "brush" | "text" | "mosaic";
type ShapeKind = "rect" | "ellipse" | "line";
type DragMode =
  | "select"
  | "move"
  | "n"
  | "s"
  | "e"
  | "w"
  | "nw"
  | "ne"
  | "sw"
  | "se"
  | "draw"
  | null;

type Annotation =
  | {
      id: string;
      type: "shape";
      shape: ShapeKind;
      rect: Rect;
      color: string;
      lineWidth: number;
      fill: boolean;
    }
  | {
      id: string;
      type: "arrow";
      start: Point;
      end: Point;
      color: string;
      lineWidth: number;
    }
  | {
      id: string;
      type: "brush";
      points: Point[];
      color: string;
      lineWidth: number;
    }
  | {
      id: string;
      type: "text";
      x: number;
      y: number;
      text: string;
      color: string;
      fontSize: number;
    };

type TextEditorState = {
  x: number;
  y: number;
  value: string;
};

const MIN_SELECTION_SIZE = 10;
const TOOLBAR_WIDTH = 608;
const TOOLBAR_HEIGHT = 52;
const COLORS = ["#FF3B30", "#FFCC00", "#34C759", "#007AFF", "#1C1C1E"];
const FONT_SIZES = [12, 14, 16, 18, 24, 32];

export function ScreenshotWindowHost() {
  const [capture, setCapture] = useState<ScreenshotCapturePayload | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [selection, setSelection] = useState<Rect | null>(null);
  const [selectionLocked, setSelectionLocked] = useState(false);
  const [roundRadius, setRoundRadius] = useState(0);
  const [shadowEnabled, setShadowEnabled] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>("shape");
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect");
  const [lineWidth, setLineWidth] = useState(4);
  const [fontSize, setFontSize] = useState(18);
  const [color, setColor] = useState(COLORS[0]);
  const [fillShape, setFillShape] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [draftAnnotation, setDraftAnnotation] = useState<Annotation | null>(null);
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [screenScale, setScreenScale] = useState(1);
  const [restoreChatWindow, setRestoreChatWindow] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    mode: DragMode;
    start: Point;
    originRect: Rect | null;
    annotation: Annotation | null;
  } | null>(null);

  const displaySize = useMemo(() => {
    if (!capture) {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    const scale = Math.min(window.innerWidth / capture.width, window.innerHeight / capture.height);
    return {
      width: Math.round(capture.width * scale),
      height: Math.round(capture.height * scale),
    };
  }, [capture]);

  const canvasStyle = useMemo<CSSProperties>(
    () => ({
      width: `${displaySize.width}px`,
      height: `${displaySize.height}px`,
    }),
    [displaySize],
  );

  const loadPayload = useCallback((payload: ScreenshotOpenPayload | null | undefined) => {
    if (!payload?.capture?.imagePath) {
      return;
    }
    const nextUrl = convertFileSrc(payload.capture.imagePath);
    imageRef.current = null;
    setCapture(payload.capture);
    setImageUrl(nextUrl);
    setSelection(null);
    setSelectionLocked(false);
    setRoundRadius(0);
    setShadowEnabled(false);
    setActiveTool("shape");
    setShapeKind("rect");
    setLineWidth(4);
    setFontSize(18);
    setColor(COLORS[0]);
    setFillShape(false);
    setAnnotations([]);
    setDraftAnnotation(null);
    setTextEditor(null);
    setToast("");
    setBusy(false);
    setLoading(false);
    setRestoreChatWindow(Boolean(payload.hiddenChatWindow));
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      window.requestAnimationFrame(() => redrawCanvas());
    };
    image.src = nextUrl;
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenStart: (() => void) | null = null;
    let unlisten: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;
    setLoading(true);
    async function bind() {
      unlistenStart = await listen<void>(SCREENSHOT_OPEN_START_EVENT, () => {
        if (!disposed) {
          imageRef.current = null;
          setCapture(null);
          setImageUrl("");
          setSelection(null);
          setSelectionLocked(false);
          setAnnotations([]);
          setDraftAnnotation(null);
          setTextEditor(null);
          setToast("");
          setBusy(false);
          setLoading(true);
        }
      });
      try {
        const payload = await invoke<ScreenshotOpenPayload | null>(
          "get_screenshot_open_payload",
        );
        if (!disposed) {
          loadPayload(payload);
        }
      } catch {
        // Window can still receive the event after it is shown.
      }
      unlisten = await listen<ScreenshotOpenPayload>(
        SCREENSHOT_OPEN_EVENT,
        (event) => {
          if (!disposed) {
            loadPayload(event.payload);
          }
        },
      );
      unlistenError = await listen<ScreenshotOpenErrorPayload>(
        SCREENSHOT_OPEN_ERROR_EVENT,
        (event) => {
          if (!disposed) {
            setLoading(false);
            setToast(event.payload.message || "截图失败");
          }
        },
      );
    }
    void bind();
    return () => {
      disposed = true;
      unlistenStart?.();
      unlisten?.();
      unlistenError?.();
    };
  }, [loadPayload]);

  useEffect(() => {
    const nextScale = capture
      ? Math.min(window.innerWidth / capture.width, window.innerHeight / capture.height)
      : 1;
    setScreenScale(nextScale || 1);
  }, [capture, displaySize]);

  useEffect(() => {
    redrawCanvas();
  }, [
    annotations,
    capture,
    displaySize,
    draftAnnotation,
    imageUrl,
    roundRadius,
    selection,
    shadowEnabled,
  ]);

  useEffect(() => {
    if (textEditor) {
      window.requestAnimationFrame(() => textInputRef.current?.focus());
    }
  }, [textEditor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void closeScreenshotWindow();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [annotations]);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !capture || !image) {
      return;
    }
    canvas.width = displaySize.width;
    canvas.height = displaySize.height;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, displaySize.width, displaySize.height);

    context.save();
    context.fillStyle = "rgba(0, 0, 0, 0.45)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (selection) {
      context.globalCompositeOperation = "destination-out";
      drawRoundedRect(context, selection, roundRadius);
      context.fill();
      context.globalCompositeOperation = "source-over";
    }
    context.restore();

    if (selection) {
      drawSelectionFrame(context, selection, selectionLocked, shadowEnabled, roundRadius);
    }
    annotations.forEach((annotation) => drawAnnotation(context, annotation));
    if (draftAnnotation) {
      drawAnnotation(context, draftAnnotation);
    }
  }, [
    annotations,
    capture,
    displaySize.height,
    displaySize.width,
    draftAnnotation,
    roundRadius,
    selection,
    selectionLocked,
    shadowEnabled,
  ]);

  const clientPoint = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    };
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (busy) {
      return;
    }
    commitTextEditor();
    const point = clientPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (!selection || !selectionLocked) {
      dragRef.current = {
        pointerId: event.pointerId,
        mode: "select",
        start: point,
        originRect: null,
        annotation: null,
      };
      setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
      setSelectionLocked(false);
      return;
    }

    const handle = hitTestHandle(selection, point);
    if (handle) {
      dragRef.current = {
        pointerId: event.pointerId,
        mode: handle,
        start: point,
        originRect: selection,
        annotation: null,
      };
      return;
    }

    if (!pointInRect(point, selection)) {
      return;
    }

    if (activeTool === "text") {
      setTextEditor({ x: point.x, y: point.y, value: "" });
      return;
    }

    const annotation = createDraftAnnotation(activeTool, point, point, {
      shapeKind,
      color,
      lineWidth,
      fillShape,
      fontSize,
    });
    dragRef.current = {
      pointerId: event.pointerId,
      mode: "draw",
      start: point,
      originRect: selection,
      annotation,
    };
    setDraftAnnotation(annotation);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const point = clientPoint(event);
    if (drag.mode === "select") {
      setSelection(normalizeRect(drag.start, point));
      return;
    }
    if (drag.mode && isResizeMode(drag.mode) && drag.originRect) {
      setSelection(resizeRect(drag.originRect, drag.mode, drag.start, point));
      return;
    }
    if (drag.mode === "draw" && drag.annotation) {
      const next = updateDraftAnnotation(drag.annotation, drag.start, point);
      drag.annotation = next;
      setDraftAnnotation(next);
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (drag.mode === "select") {
      setSelection((current) => {
        if (!current || current.width < MIN_SELECTION_SIZE || current.height < MIN_SELECTION_SIZE) {
          setSelectionLocked(false);
          return null;
        }
        setSelectionLocked(true);
        return current;
      });
      return;
    }

    if (drag.mode === "draw" && draftAnnotation) {
      if (isMeaningfulAnnotation(draftAnnotation)) {
        setAnnotations((current) => [...current, draftAnnotation]);
      }
      setDraftAnnotation(null);
    }
  };

  const commitTextEditor = () => {
    if (!textEditor) {
      return;
    }
    const text = textEditor.value.trim();
    if (text) {
      setAnnotations((current) => [
        ...current,
        {
          id: newId(),
          type: "text",
          x: textEditor.x,
          y: textEditor.y,
          text,
          color,
          fontSize,
        },
      ]);
    }
    setTextEditor(null);
  };

  const undo = () => {
    setAnnotations((current) => current.slice(0, -1));
    setDraftAnnotation(null);
    setTextEditor(null);
  };

  const closeScreenshotWindow = async () => {
    setTextEditor(null);
    setDraftAnnotation(null);
    await invoke("hide_screenshot_window").catch(() => undefined);
    if (restoreChatWindow) {
      await invoke("open_chat_window").catch(() => undefined);
    }
  };

  const exportSelectionPng = async (): Promise<Uint8Array> => {
    commitTextEditor();
    if (!selection || !capture || !imageRef.current) {
      throw new Error("请先框选截图区域");
    }
    const exportCanvas = document.createElement("canvas");
    const ratio = capture.width / displaySize.width;
    exportCanvas.width = Math.max(1, Math.round(selection.width * ratio));
    exportCanvas.height = Math.max(1, Math.round(selection.height * ratio));
    const context = exportCanvas.getContext("2d");
    if (!context) {
      throw new Error("无法创建截图画布");
    }
    if (shadowEnabled) {
      context.shadowColor = "rgba(15, 23, 42, 0.22)";
      context.shadowBlur = 18;
      context.shadowOffsetY = 4;
    }
    context.save();
    drawRoundedRect(
      context,
      { x: 0, y: 0, width: exportCanvas.width, height: exportCanvas.height },
      roundRadius * ratio,
    );
    context.clip();
    context.drawImage(
      imageRef.current,
      Math.round(selection.x * ratio),
      Math.round(selection.y * ratio),
      exportCanvas.width,
      exportCanvas.height,
      0,
      0,
      exportCanvas.width,
      exportCanvas.height,
    );
    context.restore();

    context.save();
    context.translate(-selection.x * ratio, -selection.y * ratio);
    context.scale(ratio, ratio);
    annotations.forEach((annotation) => drawAnnotation(context, annotation));
    context.restore();

    const blob = await new Promise<Blob | null>((resolve) =>
      exportCanvas.toBlob(resolve, "image/png"),
    );
    if (!blob) {
      throw new Error("截图导出失败");
    }
    return new Uint8Array(await blob.arrayBuffer());
  };

  const savePng = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setToast("正在保存截图...");
    try {
      const bytes = Array.from(await exportSelectionPng());
      const result = await invoke<{ path?: string | null; cancelled: boolean }>(
        "save_screenshot_png",
        { pngBytes: bytes },
      );
      setToast(result.cancelled ? "" : "截图已保存");
    } catch (error) {
      setToast(String(error));
    } finally {
      setBusy(false);
    }
  };

  const copyPngAndClose = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setToast("正在复制截图...");
    try {
      const bytes = Array.from(await exportSelectionPng());
      await invoke("copy_screenshot_png_to_clipboard", { pngBytes: bytes });
      setToast("截图已复制到剪贴板");
      window.setTimeout(() => void closeScreenshotWindow(), 260);
    } catch (error) {
      setToast(String(error));
      setBusy(false);
    }
  };

  const showPendingFeature = (label: string) => {
    setToast(`${label}将在下一阶段接入`);
    window.setTimeout(() => setToast(""), 1800);
  };

  const toolbarPosition = toolbarPositionFor(selection, displaySize);
  const infoPosition = infoPositionFor(selection);
  const cursor = cursorForPoint(selection, selectionLocked);

  return (
    <main className="screenshot-root">
      <div className="screenshot-canvas-stage" style={canvasStyle}>
        <canvas
          ref={canvasRef}
          className="screenshot-canvas"
          style={{ ...canvasStyle, cursor }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        {textEditor ? (
          <textarea
            ref={textInputRef}
            className="screenshot-text-editor"
            value={textEditor.value}
            style={{
              left: textEditor.x,
              top: textEditor.y,
              color,
              fontSize,
            }}
            onChange={(event) =>
              setTextEditor((current) =>
                current ? { ...current, value: event.currentTarget.value } : current,
              )
            }
            onBlur={commitTextEditor}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setTextEditor(null);
              }
              if (event.key === "Enter" && event.ctrlKey) {
                event.preventDefault();
                commitTextEditor();
              }
            }}
          />
        ) : null}
      </div>

      {selection && infoPosition ? (
        <div
          className="screenshot-info-bar"
          style={{ left: infoPosition.left, top: infoPosition.top }}
        >
          <span>
            {Math.round(selection.width / screenScale)} * {Math.round(selection.height / screenScale)}
          </span>
          <label>
            圆角
            <input
              type="range"
              min={0}
              max={24}
              value={roundRadius}
              onChange={(event) => setRoundRadius(Number(event.currentTarget.value))}
            />
          </label>
          <span>{roundRadius}</span>
          <label>
            阴影
            <input
              type="checkbox"
              checked={shadowEnabled}
              onChange={(event) => setShadowEnabled(event.currentTarget.checked)}
            />
          </label>
        </div>
      ) : null}

      {selectionLocked && toolbarPosition ? (
        <>
          <div
            className="screenshot-toolbar"
            style={{ left: toolbarPosition.left, top: toolbarPosition.top }}
          >
            <ToolbarButton
              active={activeTool === "shape"}
              label="形状"
              onClick={() => setActiveTool("shape")}
            >
              ◯□
            </ToolbarButton>
            <ToolbarButton
              active={activeTool === "arrow"}
              label="箭头"
              onClick={() => setActiveTool("arrow")}
            >
              ↗
            </ToolbarButton>
            <ToolbarButton
              active={activeTool === "brush"}
              label="画笔"
              onClick={() => setActiveTool("brush")}
            >
              ✎
            </ToolbarButton>
            <ToolbarButton
              active={activeTool === "text"}
              label="文字"
              onClick={() => setActiveTool("text")}
            >
              A
            </ToolbarButton>
            <ToolbarButton
              active={activeTool === "mosaic"}
              label="马赛克"
              onClick={() => {
                setActiveTool("mosaic");
                showPendingFeature("马赛克");
              }}
            >
              ▦
            </ToolbarButton>
            <ToolbarButton label="长截图" onClick={() => showPendingFeature("长截图")}>
              ↕
            </ToolbarButton>
            <ToolbarButton label="撤销" disabled={annotations.length === 0} onClick={undo}>
              ↶
            </ToolbarButton>
            <span className="screenshot-toolbar-separator" />
            <ToolbarButton label="转发" onClick={() => showPendingFeature("转发")}>
              ↷
            </ToolbarButton>
            <ToolbarButton label="保存" onClick={() => void savePng()}>
              ↓
            </ToolbarButton>
            <ToolbarButton danger label="取消" onClick={() => void closeScreenshotWindow()}>
              ×
            </ToolbarButton>
            <ToolbarButton success label="完成" onClick={() => void copyPngAndClose()}>
              ✓
            </ToolbarButton>
          </div>

          <ToolOptionsPanel
            tool={activeTool}
            shapeKind={shapeKind}
            lineWidth={lineWidth}
            fontSize={fontSize}
            color={color}
            fillShape={fillShape}
            toolbarPosition={toolbarPosition}
            onShapeKindChange={setShapeKind}
            onLineWidthChange={setLineWidth}
            onFontSizeChange={setFontSize}
            onColorChange={setColor}
            onFillShapeChange={setFillShape}
          />
        </>
      ) : null}

      {!selection ? (
        <div className="screenshot-hint">
          {loading ? "正在准备截图..." : "拖拽鼠标框选截图区域，按 Esc 退出"}
        </div>
      ) : null}
      {toast ? <div className="screenshot-toast">{toast}</div> : null}
    </main>
  );
}

function ToolbarButton({
  active = false,
  children,
  danger = false,
  disabled = false,
  label,
  success = false,
  onClick,
}: {
  active?: boolean;
  children: string;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  success?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={[
        active ? "is-active" : "",
        danger ? "is-danger" : "",
        success ? "is-success" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ToolOptionsPanel({
  tool,
  shapeKind,
  lineWidth,
  fontSize,
  color,
  fillShape,
  toolbarPosition,
  onShapeKindChange,
  onLineWidthChange,
  onFontSizeChange,
  onColorChange,
  onFillShapeChange,
}: {
  tool: Tool;
  shapeKind: ShapeKind;
  lineWidth: number;
  fontSize: number;
  color: string;
  fillShape: boolean;
  toolbarPosition: { left: number; top: number };
  onShapeKindChange: (kind: ShapeKind) => void;
  onLineWidthChange: (width: number) => void;
  onFontSizeChange: (size: number) => void;
  onColorChange: (color: string) => void;
  onFillShapeChange: (fill: boolean) => void;
}) {
  if (tool === "mosaic") {
    return null;
  }
  return (
    <div
      className="screenshot-sub-toolbar"
      style={{ left: toolbarPosition.left, top: toolbarPosition.top + TOOLBAR_HEIGHT + 8 }}
    >
      {tool === "shape" ? (
        <>
          <button
            type="button"
            className={shapeKind === "rect" ? "is-active" : ""}
            onClick={() => onShapeKindChange("rect")}
          >
            □
          </button>
          <button
            type="button"
            className={shapeKind === "ellipse" ? "is-active" : ""}
            onClick={() => onShapeKindChange("ellipse")}
          >
            ○
          </button>
          <button
            type="button"
            className={shapeKind === "line" ? "is-active" : ""}
            onClick={() => onShapeKindChange("line")}
          >
            ╱
          </button>
          <span className="screenshot-toolbar-separator" />
          <button
            type="button"
            className={fillShape ? "is-active" : ""}
            onClick={() => onFillShapeChange(!fillShape)}
            title="半透明填充"
          >
            ◼
          </button>
        </>
      ) : null}
      {tool === "text" ? (
        <>
          <span>大小</span>
          <select
            value={fontSize}
            onChange={(event) => onFontSizeChange(Number(event.currentTarget.value))}
          >
            {FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <span>粗细</span>
          <input
            type="range"
            min={1}
            max={10}
            value={lineWidth}
            onChange={(event) => onLineWidthChange(Number(event.currentTarget.value))}
          />
          <strong>{lineWidth}</strong>
        </>
      )}
      <span className="screenshot-toolbar-separator" />
      <div className="screenshot-color-row">
        {COLORS.map((item) => (
          <button
            key={item}
            type="button"
            className={item === color ? "is-active" : ""}
            style={{ "--screenshot-color": item } as CSSProperties}
            onClick={() => onColorChange(item)}
            title={item}
          />
        ))}
        <label className="screenshot-rainbow-color" title="自定义颜色">
          <input
            type="color"
            value={color}
            onChange={(event) => onColorChange(event.currentTarget.value)}
          />
        </label>
      </div>
    </div>
  );
}

function createDraftAnnotation(
  tool: Tool,
  start: Point,
  end: Point,
  options: {
    shapeKind: ShapeKind;
    color: string;
    lineWidth: number;
    fillShape: boolean;
    fontSize: number;
  },
): Annotation {
  if (tool === "arrow") {
    return {
      id: newId(),
      type: "arrow",
      start,
      end,
      color: options.color,
      lineWidth: options.lineWidth,
    };
  }
  if (tool === "brush") {
    return {
      id: newId(),
      type: "brush",
      points: [start],
      color: options.color,
      lineWidth: options.lineWidth,
    };
  }
  return {
    id: newId(),
    type: "shape",
    shape: options.shapeKind,
    rect: normalizeRect(start, end),
    color: options.color,
    lineWidth: options.lineWidth,
    fill: options.fillShape,
  };
}

function updateDraftAnnotation(annotation: Annotation, start: Point, end: Point): Annotation {
  if (annotation.type === "arrow") {
    return { ...annotation, start, end };
  }
  if (annotation.type === "brush") {
    return { ...annotation, points: [...annotation.points, end] };
  }
  if (annotation.type === "shape") {
    return { ...annotation, rect: normalizeRect(start, end) };
  }
  return annotation;
}

function isMeaningfulAnnotation(annotation: Annotation): boolean {
  if (annotation.type === "brush") {
    return annotation.points.length > 1;
  }
  if (annotation.type === "arrow") {
    return distance(annotation.start, annotation.end) >= 3;
  }
  return annotation.type === "shape" && annotation.rect.width >= 3 && annotation.rect.height >= 3;
}

function drawAnnotation(context: CanvasRenderingContext2D, annotation: Annotation) {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = annotation.color;
  context.fillStyle = annotation.color;
  if (annotation.type === "shape") {
    context.lineWidth = annotation.lineWidth;
    if (annotation.shape === "ellipse") {
      context.beginPath();
      context.ellipse(
        annotation.rect.x + annotation.rect.width / 2,
        annotation.rect.y + annotation.rect.height / 2,
        Math.abs(annotation.rect.width / 2),
        Math.abs(annotation.rect.height / 2),
        0,
        0,
        Math.PI * 2,
      );
    } else if (annotation.shape === "line") {
      context.beginPath();
      context.moveTo(annotation.rect.x, annotation.rect.y);
      context.lineTo(
        annotation.rect.x + annotation.rect.width,
        annotation.rect.y + annotation.rect.height,
      );
    } else {
      context.beginPath();
      context.rect(annotation.rect.x, annotation.rect.y, annotation.rect.width, annotation.rect.height);
    }
    if (annotation.fill && annotation.shape !== "line") {
      context.globalAlpha = 0.3;
      context.fill();
      context.globalAlpha = 1;
    }
    context.stroke();
  } else if (annotation.type === "arrow") {
    context.lineWidth = annotation.lineWidth;
    drawArrow(context, annotation.start, annotation.end);
  } else if (annotation.type === "brush") {
    context.lineWidth = annotation.lineWidth;
    context.beginPath();
    annotation.points.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    context.stroke();
  } else {
    context.font = `${annotation.fontSize}px "Microsoft YaHei", sans-serif`;
    context.textBaseline = "top";
    annotation.text.split("\n").forEach((line, index) => {
      context.fillText(line, annotation.x, annotation.y + index * annotation.fontSize * 1.35);
    });
  }
  context.restore();
}

function drawArrow(context: CanvasRenderingContext2D, start: Point, end: Point) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = 10 + context.lineWidth * 1.5;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - headLength * Math.cos(angle - Math.PI / 6),
    end.y - headLength * Math.sin(angle - Math.PI / 6),
  );
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - headLength * Math.cos(angle + Math.PI / 6),
    end.y - headLength * Math.sin(angle + Math.PI / 6),
  );
  context.stroke();
}

function drawSelectionFrame(
  context: CanvasRenderingContext2D,
  rect: Rect,
  locked: boolean,
  shadow: boolean,
  radius: number,
) {
  context.save();
  if (shadow) {
    context.shadowColor = "rgba(0, 123, 255, 0.25)";
    context.shadowBlur = 12;
  }
  context.strokeStyle = "#007BFF";
  context.lineWidth = 1.5;
  drawRoundedRect(context, rect, radius);
  context.stroke();
  context.restore();

  if (!locked) {
    return;
  }
  context.save();
  context.fillStyle = "#ffffff";
  context.strokeStyle = "#007BFF";
  handlePoints(rect).forEach((point) => {
    context.beginPath();
    context.arc(point.x, point.y, 4, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });
  context.restore();
}

function drawRoundedRect(context: CanvasRenderingContext2D, rect: Rect, radius: number) {
  const safeRadius = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  context.beginPath();
  context.moveTo(rect.x + safeRadius, rect.y);
  context.lineTo(rect.x + rect.width - safeRadius, rect.y);
  context.quadraticCurveTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + safeRadius);
  context.lineTo(rect.x + rect.width, rect.y + rect.height - safeRadius);
  context.quadraticCurveTo(
    rect.x + rect.width,
    rect.y + rect.height,
    rect.x + rect.width - safeRadius,
    rect.y + rect.height,
  );
  context.lineTo(rect.x + safeRadius, rect.y + rect.height);
  context.quadraticCurveTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - safeRadius);
  context.lineTo(rect.x, rect.y + safeRadius);
  context.quadraticCurveTo(rect.x, rect.y, rect.x + safeRadius, rect.y);
}

function handlePoints(rect: Rect): Array<Point & { mode: Exclude<DragMode, null> }> {
  const midX = rect.x + rect.width / 2;
  const midY = rect.y + rect.height / 2;
  return [
    { mode: "nw", x: rect.x, y: rect.y },
    { mode: "n", x: midX, y: rect.y },
    { mode: "ne", x: rect.x + rect.width, y: rect.y },
    { mode: "e", x: rect.x + rect.width, y: midY },
    { mode: "se", x: rect.x + rect.width, y: rect.y + rect.height },
    { mode: "s", x: midX, y: rect.y + rect.height },
    { mode: "sw", x: rect.x, y: rect.y + rect.height },
    { mode: "w", x: rect.x, y: midY },
  ];
}

function hitTestHandle(rect: Rect, point: Point): DragMode {
  const hit = handlePoints(rect).find((item) => distance(item, point) <= 8);
  return hit?.mode ?? null;
}

function resizeRect(origin: Rect, mode: DragMode, start: Point, point: Point): Rect {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.width;
  let bottom = origin.y + origin.height;
  if (mode?.includes("w")) left += dx;
  if (mode?.includes("e")) right += dx;
  if (mode?.includes("n")) top += dy;
  if (mode?.includes("s")) bottom += dy;
  return normalizeRect({ x: left, y: top }, { x: right, y: bottom });
}

function normalizeRect(start: Point, end: Point): Rect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function toolbarPositionFor(
  selection: Rect | null,
  displaySize: { width: number; height: number },
): { left: number; top: number } | null {
  if (!selection) {
    return null;
  }
  const preferredTop =
    displaySize.height - selection.y - selection.height < 84
      ? selection.y - TOOLBAR_HEIGHT - 8
      : selection.y + selection.height + 8;
  return {
    left: clamp(
      selection.x + selection.width - TOOLBAR_WIDTH,
      8,
      Math.max(8, displaySize.width - TOOLBAR_WIDTH - 8),
    ),
    top: clamp(preferredTop, 8, displaySize.height - TOOLBAR_HEIGHT - 8),
  };
}

function infoPositionFor(selection: Rect | null): { left: number; top: number } | null {
  if (!selection) {
    return null;
  }
  return {
    left: Math.max(8, selection.x),
    top: Math.max(8, selection.y - 42),
  };
}

function cursorForPoint(selection: Rect | null, locked: boolean): string {
  if (!selection || !locked) {
    return "crosshair";
  }
  return "crosshair";
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function isResizeMode(mode: DragMode): mode is Exclude<DragMode, "select" | "draw" | "move" | null> {
  return Boolean(mode && ["n", "s", "e", "w", "nw", "ne", "sw", "se"].includes(mode));
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
