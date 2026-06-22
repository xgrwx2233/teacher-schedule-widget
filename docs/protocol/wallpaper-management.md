# Wallpaper Management Protocol

Wallpaper management is a chat-integrated device management feature. It is not remote desktop control.

## States

```text
created
waiting_confirm
accepted
rejected
uploading
applying
finished
failed
cancelled
```

## Wallpaper Task

```json
{
  "id": "wallpaper_10001",
  "conversationId": "conv_10001",
  "requesterId": "u_10001",
  "targetUserId": "u_10002",
  "fileObjectId": "file_10001",
  "status": "waiting_confirm",
  "failureReason": null,
  "createdAt": "2026-06-19T02:20:00Z",
  "updatedAt": "2026-06-19T02:20:00Z"
}
```

Files are stored in OSS. The backend issues upload parameters and records the `file_object`.
