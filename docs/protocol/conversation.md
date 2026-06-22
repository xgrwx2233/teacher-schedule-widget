# Conversation Model

## Conversation Types

```text
direct
group
device
```

`direct` is a 1-to-1 teacher chat. `group` is a normal group chat. `device` is a device-related conversation used for communication with a managed classroom or office computer.

## Conversation

```json
{
  "id": "conv_10001",
  "type": "direct",
  "title": "王老师 - 数学组",
  "avatarFileId": "file_avatar_10001",
  "peerUserId": "u_10002",
  "groupId": null,
  "deviceId": null,
  "lastMessageId": "msg_10009",
  "lastMessagePreview": "好的，稍后处理。",
  "lastMessageAt": "2026-06-19T02:20:00Z",
  "unreadCount": 3,
  "pinned": false,
  "muted": false,
  "archived": false,
  "serverSeq": 1024,
  "createdAt": "2026-06-19T02:00:00Z",
  "updatedAt": "2026-06-19T02:20:00Z"
}
```

## Required Client Behaviors

- Selecting a conversation should clear local visual unread state after the backend accepts the read cursor.
- Removing a conversation from the message list only archives it for the current user. It must not delete messages globally.
- Pinning is per user.
- Muting is per user.

## List API

```text
GET /chat/conversations?cursor=&limit=30
```

Returns newest active conversations, pinned conversations first.

## Archive API

```text
POST /chat/conversations/{conversationId}/archive
```

Archives the conversation for the current user.

## Pin API

```text
POST /chat/conversations/{conversationId}/pin
POST /chat/conversations/{conversationId}/unpin
```
