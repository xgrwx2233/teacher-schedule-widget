import type { ChatMessage, ImagePreviewItem, UploadedChatFile } from "./types";

export type ParsedQuoteMessage = {
  id: string;
  senderLabel: string;
  preview: string;
};

export function messagePreview(message: ChatMessage): string {
  if (message.status === "revoked") {
    return "消息已撤回";
  }
  if (message.kind === "image") {
    return "[图片]";
  }
  if (message.kind === "sticker") {
    return "[表情]";
  }
  if (message.kind === "file") {
    return `[文件] ${fileNameFromMessage(message, "文件")}`;
  }
  if (message.kind === "system") {
    return message.content || "[系统消息]";
  }
  if (message.kind === "call_event") {
    return message.content || "[通话]";
  }
  return message.content;
}

export function fileUrlFromMessage(message: ChatMessage): string {
  const value = message.contentJson?.url;
  return typeof value === "string" ? value : "";
}

export function fileObjectIdFromMessage(message: ChatMessage): string {
  const value =
    normalizeFileObjectId(message.fileObjectId) ??
    normalizeFileObjectId(message.contentJson?.fileObjectId) ??
    normalizeFileObjectId(message.contentJson?.fileId);
  return value ?? "";
}

export function normalizeFileObjectId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return /^file_[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

export function fileContentJsonFromObject(
  file: Pick<
    UploadedChatFile,
    "id" | "originalName" | "sizeBytes" | "contentType" | "url"
  >,
  fallbackName: string,
): Record<string, unknown> {
  return {
    fileId: file.id,
    fileObjectId: file.id,
    fileName: file.originalName || fallbackName,
    sizeBytes: file.sizeBytes,
    contentType: file.contentType || "application/octet-stream",
    url: file.url || null,
  };
}

export function mediaContentJsonFromMessage(
  message: ChatMessage,
  fileObjectId: string,
): Record<string, unknown> {
  const base =
    message.contentJson && typeof message.contentJson === "object"
      ? { ...message.contentJson }
      : {};
  base.fileId = fileObjectId;
  base.fileObjectId = fileObjectId;
  base.fileName = fileNameFromMessage(
    message,
    message.kind === "image" ? "图片" : message.kind === "sticker" ? "表情" : "文件",
  );
  base.sizeBytes = sizeBytesFromMessage(message);
  base.contentType =
    contentTypeFromMessage(message) ||
    (message.kind === "image"
      ? "image/jpeg"
      : message.kind === "sticker"
        ? "image/webp"
        : "application/octet-stream");
  base.url = null;
  return base;
}

export function contentTypeFromFilename(fileName: string, fallback: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".bmp")) {
    return "image/bmp";
  }
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".doc")) {
    return "application/msword";
  }
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xls")) {
    return "application/vnd.ms-excel";
  }
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".ppt")) {
    return "application/vnd.ms-powerpoint";
  }
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (lower.endsWith(".txt")) {
    return "text/plain";
  }
  if (lower.endsWith(".zip")) {
    return "application/zip";
  }
  return fallback;
}

export function fileTypeFromMessage(
  message: ChatMessage,
): "image" | "file" | "sticker" | null {
  if (message.kind === "image" || message.kind === "file" || message.kind === "sticker") {
    return message.kind;
  }
  return null;
}

export function mediaPreviewText(message: ChatMessage): string {
  if (message.kind === "image") {
    return "[图片]";
  }
  if (message.kind === "sticker") {
    return "[表情]";
  }
  if (message.kind === "file") {
    return `[文件] ${fileNameFromMessage(message, "文件")}`;
  }
  return message.content || messagePreview(message);
}

export function fileObjectNotReusable(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return (
    message.includes("file object not found") ||
    message.includes("file object is not accessible") ||
    message.includes("file object type mismatch") ||
    message.includes("file not found") ||
    message.includes("file not accessible")
  );
}

export function fileUrlCandidatesFromMessage(message: ChatMessage): string[] {
  const values = [
    message.contentJson?.url,
    message.contentJson?.localUrl,
    message.contentJson?.previewUrl,
    message.contentJson?.thumbUrl,
  ];
  return values.filter(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
}

export async function blobToBytes(blob: Blob): Promise<number[]> {
  const buffer = await blob.arrayBuffer();
  return Array.from(new Uint8Array(buffer));
}

export function extensionFromContentType(contentType: string, fallback: string): string {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("png")) {
    return "png";
  }
  if (normalized.includes("jpeg") || normalized.includes("jpg")) {
    return "jpg";
  }
  if (normalized.includes("webp")) {
    return "webp";
  }
  if (normalized.includes("gif")) {
    return "gif";
  }
  if (normalized.includes("bmp")) {
    return "bmp";
  }
  return fallback.replace(/^\./, "") || "bin";
}

export function filenameWithExtension(fileName: string, extension: string): string {
  if (/\.[A-Za-z0-9]{1,8}$/.test(fileName)) {
    return fileName;
  }
  return `${fileName}.${extension.replace(/^\./, "") || "bin"}`;
}

export function imagePreviewItemFromMessage(
  message: ChatMessage,
): ImagePreviewItem | null {
  if (message.kind !== "image") {
    return null;
  }
  const url = fileUrlFromMessage(message);
  const fileObjectId = fileObjectIdFromMessage(message);
  if (!url && !fileObjectId) {
    return null;
  }
  return {
    id: message.id,
    url: fileObjectId ? null : url || null,
    fileObjectId: fileObjectId || null,
    fileName: fileNameFromMessage(message, "图片"),
  };
}

export function fileNameFromMessage(
  message: ChatMessage,
  fallback: string,
): string {
  const value =
    message.contentJson?.fileName ??
    message.contentJson?.originalName ??
    message.content;
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function quoteFromMessage(
  message: ChatMessage,
): ParsedQuoteMessage | null {
  const value = message.contentJson?.quote;
  if (!value || typeof value !== "object") {
    return null;
  }
  const quote = value as Record<string, unknown>;
  const id = quote.messageId;
  const senderLabel = quote.senderLabel;
  const preview = quote.preview;
  if (
    typeof id !== "string" ||
    typeof senderLabel !== "string" ||
    typeof preview !== "string"
  ) {
    return null;
  }
  return { id, senderLabel, preview };
}

export function sizeBytesFromMessage(message: ChatMessage): number {
  const value = message.contentJson?.sizeBytes;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function contentTypeFromMessage(message: ChatMessage): string {
  const value = message.contentJson?.contentType;
  return typeof value === "string" ? value : "";
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
