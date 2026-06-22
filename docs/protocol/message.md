# Message Model

## Message Types

```text
text
image
file
voice
system
```

The first backend phase implements only `text` and `system`.

## Message States

```text
local_created
sending
sent
delivered
read
failed
revoked
```

`local_created` and `sending` are client-only optimistic states. Server-persisted states begin at `sent`.

## Message

```json
{
  "id": "msg_10001",
  "conversationId": "conv_10001",
  "senderId": "u_10001",
  "messageType": "text",
  "content": "你好",
  "fileObjectId": null,
  "clientMsgId": "client_uuid",
  "serverSeq": 1024,
  "conversationSeq": 18,
  "status": "sent",
  "createdAt": "2026-06-19T02:20:00Z",
  "updatedAt": "2026-06-19T02:20:00Z",
  "revokedAt": null
}
```

## Send Text API

```text
POST /chat/messages
```

Request:

```json
{
  "conversationId": "conv_10001",
  "clientMsgId": "client_uuid",
  "messageType": "text",
  "content": "你好"
}
```

Response:

```json
{
  "message": {}
}
```

## Read API

```text
POST /chat/conversations/{conversationId}/read
```

Request:

```json
{
  "conversationSeq": 18
}
```

## Revoke API

```text
POST /chat/messages/{messageId}/revoke
```

Rules:

- Only the sender can revoke a normal message.
- Revoke time window is a product rule and should be enforced by the backend.
- Revoked messages remain as system-visible tombstones for sync consistency.
