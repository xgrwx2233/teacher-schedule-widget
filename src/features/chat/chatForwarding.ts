import {
  postTypedChatMessage,
  reuploadCachedChatFile,
  uploadChatFileBytes,
} from "./chatRepository";
import {
  blobToBytes,
  contentTypeFromFilename,
  extensionFromContentType,
  fileContentJsonFromObject,
  fileNameFromMessage,
  fileObjectIdFromMessage,
  fileObjectNotReusable,
  fileTypeFromMessage,
  fileUrlCandidatesFromMessage,
  filenameWithExtension,
  mediaContentJsonFromMessage,
  mediaPreviewText,
  messagePreview,
} from "./chatMessageUtils";
import type { ChatMessage } from "./types";

export async function forwardChatMessage(
  source: ChatMessage,
  targetConversationId: string,
): Promise<ChatMessage> {
  const fileType = fileTypeFromMessage(source);
  if (!fileType) {
    return postTypedChatMessage({
      conversationId: targetConversationId,
      messageType: "text",
      content:
        source.kind === "text"
          ? source.content
          : `${messagePreview(source)} ${source.content || ""}`.trim(),
      contentJson: source.contentJson ?? null,
    });
  }

  const fileObjectId = fileObjectIdFromMessage(source);
  if (fileObjectId) {
    try {
      return await postTypedChatMessage({
        conversationId: targetConversationId,
        messageType: source.kind,
        content: source.content || mediaPreviewText(source),
        contentJson: mediaContentJsonFromMessage(source, fileObjectId),
        fileObjectId,
      });
    } catch (error) {
      if (!fileObjectNotReusable(error)) {
        throw error;
      }
    }
  }

  const uploaded = await reuploadMessageFile(source, fileObjectId);
  return postTypedChatMessage({
    conversationId: targetConversationId,
    messageType: source.kind,
    content: source.content || mediaPreviewText(source),
    contentJson: fileContentJsonFromObject(uploaded, fileNameFromMessage(source, "文件")),
    fileObjectId: uploaded.id,
  });
}

async function reuploadMessageFile(source: ChatMessage, fileObjectId: string) {
  const fileType = fileTypeFromMessage(source);
  if (!fileType) {
    throw new Error("当前消息不是可转发的文件消息");
  }

  const fileName = fileNameFromMessage(
    source,
    fileType === "image" ? "图片" : fileType === "sticker" ? "表情" : "文件",
  );
  const fallbackContentType =
    fileType === "image"
      ? "image/jpeg"
      : fileType === "sticker"
        ? "image/webp"
        : "application/octet-stream";
  const contentType = contentTypeFromFilename(fileName, fallbackContentType);
  if (fileObjectId) {
    try {
      return await reuploadCachedChatFile({
        fileObjectId,
        fileName,
        contentType,
        fileType,
      });
    } catch {
      // Older local messages may still carry a preview URL that can be used as a fallback.
    }
  }
  const bytes = await loadForwardSourceBytes(source);
  const filename = filenameWithExtension(
    fileName,
    extensionFromContentType(contentType, fileType === "file" ? "bin" : "jpg"),
  );
  return uploadChatFileBytes({
    filename,
    contentType,
    bytes,
    fileType,
  });
}

async function loadForwardSourceBytes(source: ChatMessage): Promise<number[]> {
  for (const url of fileUrlCandidatesFromMessage(source)) {
    try {
      return await fetchUrlBytes(url);
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("当前文件本地缓存不可用，请先重新下载或重新发送后再转发");
}

async function fetchUrlBytes(url: string): Promise<number[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`读取文件失败: HTTP ${response.status}`);
  }
  return blobToBytes(await response.blob());
}
