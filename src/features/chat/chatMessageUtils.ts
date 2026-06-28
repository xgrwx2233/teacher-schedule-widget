import { invoke } from "@tauri-apps/api/core";
import type {
  ChatMessage,
  ChatMessageKind,
  ImagePreviewItem,
  MediaViewerItem,
  QuoteMeta,
  UploadedChatFile,
} from "./types";

function mediaDebug(label: string, payload: Record<string, unknown>): void {
  console.info(`[media-debug] ${label}`, payload);
  void invoke("media_debug_log", { label, payload }).catch(() => undefined);
}

export type ParsedQuoteMessage = {
  id: string;
  conversationId: string;
  conversationSeq?: number | null;
  senderId?: number | null;
  senderLabel: string;
  preview: string;
  messageType: ChatMessageKind | string;
  thumbnailUrl?: string | null;
  fileObjectId?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  duration?: number | null;
  isDeleted?: boolean;
  isRevoked?: boolean;
  quotedCreatedAt?: string | null;
};

export function messagePreview(message: ChatMessage): string {
  if (message.status === "revoked") {
    return "消息已撤回";
  }
  if (message.kind === "image") {
    return "[图片]";
  }
  if (message.kind === "video") {
    return "[视频]";
  }
  if ((message.kind as ChatMessageKind) === "voice") {
    const duration =
      numberFromUnknown(message.contentJson?.durationSeconds) ??
      numberFromUnknown(message.contentJson?.duration);
    return duration ? `[语音] ${Math.round(duration)}"` : message.content || "[语音]";
  }
  if (message.kind === "sticker") {
    return "[表情]";
  }
  if ((message.kind as ChatMessageKind) === "voice") {
    const duration =
      numberFromUnknown(message.contentJson?.durationSeconds) ??
      numberFromUnknown(message.contentJson?.duration);
    return duration ? `[语音] ${Math.round(duration)}"` : message.content || "[语音]";
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
  if (message.kind === "contact_card") {
    const title =
      stringFromUnknown(message.contentJson?.nickname) ||
      stringFromUnknown(message.contentJson?.title) ||
      message.content;
    return title ? `[推荐好友] ${title}` : "[推荐好友]";
  }
  if (message.kind === "group_card") {
    const title =
      stringFromUnknown(message.contentJson?.name) ||
      stringFromUnknown(message.contentJson?.title) ||
      message.content;
    return title ? `[群名片] ${title}` : "[群名片]";
  }
  if (message.kind === "group_share_card") {
    const title =
      stringFromUnknown(message.contentJson?.name) ||
      stringFromUnknown(message.contentJson?.title) ||
      message.content;
    return title ? `[群分享] ${title}` : "[群分享]";
  }
  return message.content;
}

function stringFromUnknown(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function localUrlFromUnknown(value: unknown): string {
  const text = stringFromUnknown(value);
  if (
    text.startsWith("data:") ||
    text.startsWith("blob:") ||
    text.startsWith("file:") ||
    /^[A-Za-z]:[\\/]/.test(text)
  ) {
    return text;
  }
  return "";
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
    "id" | "originalName" | "sizeBytes" | "contentType"
  >,
  fallbackName: string,
): Record<string, unknown> {
  return {
    fileId: file.id,
    fileObjectId: file.id,
    fileName: file.originalName || fallbackName,
    sizeBytes: file.sizeBytes,
    contentType: file.contentType || "application/octet-stream",
    url: null,
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
  const sourceMessageId = officialChatMessageId(message);
  if (sourceMessageId) {
    base.sourceMessageId = sourceMessageId;
  } else {
    delete base.sourceMessageId;
  }
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
  base.sourceType = "forward";
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
): "image" | "video" | "file" | "sticker" | null {
  if (message.kind === "voice") {
    return "file";
  }
  if (
    message.kind === "image" ||
    message.kind === "video" ||
    message.kind === "file" ||
    message.kind === "sticker"
  ) {
    return message.kind;
  }
  return null;
}

export function isVideoMessage(message: ChatMessage): boolean {
  if (message.kind === "video") {
    return true;
  }
  if (message.kind !== "file") {
    return false;
  }
  const contentType = contentTypeFromMessage(message).toLowerCase();
  if (contentType.startsWith("video/")) {
    return true;
  }
  return isVideoFileName(fileNameFromMessage(message, ""));
}

export function isMediaMessage(message: ChatMessage): boolean {
  return message.kind === "image" || isVideoMessage(message);
}

export function mediaPreviewText(message: ChatMessage): string {
  if (message.kind === "image") {
    return "[图片]";
  }
  if (message.kind === "video") {
    return `[视频] ${fileNameFromMessage(message, "视频")}`;
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
    message.includes("file not accessible") ||
    message.includes("文件已过期") ||
    message.includes("file is not accessible") ||
    message.includes("expired")
  );
}

export function chatFileAccessStatus(message: ChatMessage): string {
  const direct = message.fileAccess?.status;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const nested = message.contentJson?.fileAccess;
  if (nested && typeof nested === "object") {
    const value = (nested as Record<string, unknown>).status;
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "active";
}

export function chatFileCloudAvailable(message: ChatMessage): boolean {
  return chatFileAccessStatus(message) === "active";
}

export function chatFileAccessReason(message: ChatMessage): string {
  const direct = message.fileAccess?.reason;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const nested = message.contentJson?.fileAccess;
  if (nested && typeof nested === "object") {
    const value = (nested as Record<string, unknown>).reason;
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  const status = chatFileAccessStatus(message);
  if (status === "expired") {
    return "文件已过期，无法从云端预览、下载、转发或保存";
  }
  if (status === "revoked") {
    return "消息已撤回";
  }
  if (status === "blocked") {
    return "文件被安全策略拦截";
  }
  if (status === "deleted") {
    return "文件消息已删除";
  }
  return "文件暂不可访问";
}

export function officialChatMessageId(message: Pick<ChatMessage, "id">): string | null {
  const id = message.id.trim();
  return id.startsWith("msg_") ? id : null;
}

export function chatMessageFileAccessSource(
  message: Pick<ChatMessage, "id" | "fileAccess" | "contentJson">,
) {
  const messageId = officialChatMessageId(message);
  const messageFileRefId =
    normalizeMessageFileRefId(message.fileAccess?.messageFileRefId) ??
    normalizeMessageFileRefId(
      (message.contentJson?.fileAccess as Record<string, unknown> | undefined)
        ?.messageFileRefId,
    );
  if (messageFileRefId) {
    return { source: "chat" as const, messageId: messageFileRefId };
  }
  return messageId ? { source: "chat" as const, messageId } : undefined;
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
    sourceMessageId: officialChatMessageId(message),
    url: fileObjectId ? null : url || null,
    fileObjectId: fileObjectId || null,
    fileName: fileNameFromMessage(message, "图片"),
  };
}

export function mediaViewerItemFromMessage(
  message: ChatMessage,
  senderName?: string | null,
): MediaViewerItem | null {
  mediaDebug("mediaViewerItemFromMessage input", {
    id: message.id,
    kind: message.kind,
    status: message.status,
    fileObjectId: message.fileObjectId,
    contentJsonLocalPath: message.contentJson?.localPath,
    contentJsonFileObjectId: message.contentJson?.fileObjectId,
    fileAccess: message.fileAccess ?? null,
    contentJsonFileAccess: message.contentJson?.fileAccess ?? null,
  });
  if (!isMediaMessage(message)) {
    return null;
  }
  const mediaType = message.kind === "image" ? "image" : "video";
  const fileObjectId = fileObjectIdFromMessage(message);
  const sourceMessageId = officialChatMessageId(message);
  const messageFileRefId =
    normalizeMessageFileRefId(message.fileAccess?.messageFileRefId) ??
    normalizeMessageFileRefId(
      (message.contentJson?.fileAccess as Record<string, unknown> | undefined)
        ?.messageFileRefId,
    );
  const localPosterUrl =
    localUrlFromUnknown(message.contentJson?.thumbnailUrl) ||
    localUrlFromUnknown(message.contentJson?.thumbUrl) ||
    localUrlFromUnknown(message.contentJson?.previewUrl) ||
    localUrlFromUnknown(message.contentJson?.posterUrl);
  const thumbnailObjectId =
    normalizeFileObjectId(message.contentJson?.thumbnailObjectId) ||
    normalizeFileObjectId(message.contentJson?.thumbnailFileObjectId) ||
    normalizeFileObjectId(message.contentJson?.thumbObjectId) ||
    normalizeFileObjectId(message.contentJson?.posterObjectId);
  const localCandidates = localCandidatesFromMessage(message);
  if (!fileObjectId && localCandidates.length === 0) {
    return null;
  }
  const source = sourceMessageId ? "chat" : "local_pending";
  const sourceId = source === "chat" ? messageFileRefId || sourceMessageId || message.id : message.id;
  const item: MediaViewerItem = {
    id: message.id,
    messageId: message.id,
    conversationId: message.conversationId,
    sourceMessageId,
    messageFileRefId,
    source,
    sourceId,
    type: mediaType,
    localPosterUrl: localPosterUrl || null,
    fileObjectId: fileObjectId || null,
    thumbnailObjectId: thumbnailObjectId || null,
    fileName: fileNameFromMessage(message, mediaType === "image" ? "图片" : "视频"),
    fileSize: sizeBytesFromMessage(message),
    width: numberFromUnknown(message.contentJson?.width),
    height: numberFromUnknown(message.contentJson?.height),
    duration:
      numberFromUnknown(message.contentJson?.duration) ??
      numberFromUnknown(message.contentJson?.durationSeconds),
    senderId: message.senderId ?? null,
    senderName: senderName ?? null,
    sentAt: message.createdAt ?? null,
    seq: message.conversationSeq ?? message.serverSeq ?? null,
    localCandidates,
  };
  mediaDebug("mediaViewerItemFromMessage output", {
    id: item.id,
    source: item.source,
    sourceId: item.sourceId,
    messageFileRefId: item.messageFileRefId,
    fileObjectId: item.fileObjectId,
    localCandidates: item.localCandidates,
  });
  return item;
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
  if (message.quoteMeta) {
    return parsedQuoteFromMeta(message.quoteMeta);
  }
  const legacyMeta = quoteMetaFromContentJson(message.contentJson);
  if (legacyMeta) {
    return parsedQuoteFromMeta(legacyMeta);
  }
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
  return {
    id,
    conversationId: message.conversationId,
    conversationSeq: null,
    senderLabel,
    preview,
    messageType: "text",
  };
}

export function quoteMetaFromMessage(
  message: ChatMessage,
  senderLabel: string,
): QuoteMeta {
  return {
    quotedMessageId: message.id,
    quotedConversationId: message.conversationId,
    quotedConversationSeq: message.conversationSeq ?? null,
    quotedSenderId: message.senderId ?? null,
    quotedSenderName: senderLabel || "对方",
    quotedMessageType: message.kind,
    previewText: quotePrimaryPreview(message),
    thumbnailUrl: quoteThumbnailUrl(message),
    fileObjectId:
      message.kind === "image" || message.kind === "sticker" || message.kind === "voice"
        ? fileObjectIdFromMessage(message) || null
        : null,
    fileName:
      message.kind === "file" ? fileNameFromMessage(message, "文件") : null,
    fileSize:
      message.kind === "file" || message.kind === "voice"
        ? sizeBytesFromMessage(message)
        : null,
    duration:
      numberFromUnknown(message.contentJson?.durationSeconds) ??
      numberFromUnknown(message.contentJson?.duration),
    isRevoked: message.status === "revoked",
    quotedCreatedAt: message.createdAt ?? null,
  };
}

export function quotePrimaryPreview(message: ChatMessage): string {
  const preview = messagePreview(message).trim();
  return truncateQuotePreview(preview || "聊天记录", 60);
}

export function quoteMetaFromContentJson(
  contentJson?: Record<string, unknown> | null,
): QuoteMeta | null {
  const value = contentJson?.quoteMeta;
  if (!value || typeof value !== "object") {
    return null;
  }
  return normalizeQuoteMeta(value as Record<string, unknown>);
}

export function withQuoteMeta(
  contentJson: Record<string, unknown> | null | undefined,
  quoteMeta: QuoteMeta | null,
): Record<string, unknown> | null {
  const base =
    contentJson && typeof contentJson === "object" ? { ...contentJson } : {};
  delete base.quote;
  delete base.quoteMeta;
  if (quoteMeta) {
    base.quoteMeta = quoteMeta;
  }
  return Object.keys(base).length > 0 ? base : null;
}

function parsedQuoteFromMeta(meta: QuoteMeta): ParsedQuoteMessage | null {
  if (!meta.quotedMessageId || !meta.quotedConversationId) {
    return null;
  }
  return {
    id: meta.quotedMessageId,
    conversationId: meta.quotedConversationId,
    conversationSeq: meta.quotedConversationSeq ?? null,
    senderId: meta.quotedSenderId ?? null,
    senderLabel: meta.quotedSenderName || "对方",
    preview: meta.isRevoked
      ? "原消息已撤回"
      : meta.isDeleted
        ? "原消息不可查看"
        : truncateQuotePreview(meta.previewText || "聊天记录", 80),
    messageType: meta.quotedMessageType || "text",
    thumbnailUrl: meta.thumbnailUrl ?? null,
    fileObjectId: meta.fileObjectId ?? null,
    fileName: meta.fileName ?? null,
    fileSize: meta.fileSize ?? null,
    duration: meta.duration ?? null,
    isDeleted: meta.isDeleted,
    isRevoked: meta.isRevoked,
    quotedCreatedAt: meta.quotedCreatedAt ?? null,
  };
}

function normalizeQuoteMeta(value: Record<string, unknown>): QuoteMeta | null {
  const quotedMessageId = stringFromUnknown(value.quotedMessageId);
  const quotedConversationId = stringFromUnknown(value.quotedConversationId);
  const quotedSenderName = stringFromUnknown(value.quotedSenderName);
  const quotedMessageType = stringFromUnknown(value.quotedMessageType) || "text";
  if (!quotedMessageId || !quotedConversationId) {
    return null;
  }
  return {
    quotedMessageId,
    quotedConversationId,
    quotedConversationSeq: numberFromUnknown(value.quotedConversationSeq),
    quotedSenderId: numberFromUnknown(value.quotedSenderId),
    quotedSenderName: quotedSenderName || "对方",
    quotedMessageType,
    previewText:
      truncateQuotePreview(stringFromUnknown(value.previewText), 80) || "聊天记录",
    thumbnailUrl: stringFromUnknown(value.thumbnailUrl) || null,
    fileObjectId: normalizeFileObjectId(value.fileObjectId),
    fileName: stringFromUnknown(value.fileName) || null,
    fileSize: numberFromUnknown(value.fileSize),
    duration: numberFromUnknown(value.duration),
    isDeleted: value.isDeleted === true,
    isRevoked: value.isRevoked === true,
    quotedCreatedAt: stringFromUnknown(value.quotedCreatedAt) || null,
  };
}

function quoteThumbnailUrl(message: ChatMessage): string | null {
  if (
    message.kind !== "image" &&
    message.kind !== "sticker" &&
    message.kind !== "contact_card" &&
    message.kind !== "group_card" &&
    message.kind !== "group_share_card"
  ) {
    return null;
  }
  const value =
    message.contentJson?.thumbUrl ??
    message.contentJson?.previewUrl ??
    message.contentJson?.url ??
    message.contentJson?.avatarUrl;
  return typeof value === "string" && value.trim() ? value : null;
}

function truncateQuotePreview(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function numberFromUnknown(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeMessageFileRefId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.startsWith("mref_") ? trimmed : null;
}

function localCandidatesFromMessage(
  message: ChatMessage,
): NonNullable<MediaViewerItem["localCandidates"]> {
  const candidates: NonNullable<MediaViewerItem["localCandidates"]> = [];
  const add = (
    value: unknown,
    sourceType: "local_original" | "local_download" | "local_preview_cache",
    label: string,
  ) => {
    if (typeof value !== "string") {
      return;
    }
    const path = value.trim();
    if (!path || path.startsWith("http://") || path.startsWith("https://")) {
      return;
    }
    if (candidates.some((item) => item.path === path)) {
      return;
    }
    candidates.push({ path, sourceType, label });
  };
  add(message.contentJson?.localPath, "local_original", "本地原文件");
  add(message.contentJson?.filePath, "local_original", "本地原文件");
  add(message.contentJson?.downloadPath, "local_download", "本地下载文件");
  add(message.contentJson?.cachePath, "local_preview_cache", "本地预览缓存");
  add(message.contentJson?.url, "local_preview_cache", "本地预览缓存");
  return candidates;
}

export function sizeBytesFromMessage(message: ChatMessage): number {
  const value = message.contentJson?.sizeBytes;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function contentTypeFromMessage(message: ChatMessage): string {
  const value = message.contentJson?.contentType;
  return typeof value === "string" ? value : "";
}

function isVideoFileName(fileName: string): boolean {
  return /\.(mp4|mov|webm|avi|mkv)$/i.test(fileName.trim());
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
