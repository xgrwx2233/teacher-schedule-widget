# Device Command Protocol

The current phase only includes remote shutdown. Remote desktop control is explicitly out of scope.

## Command Types

```text
shutdown
```

## States

```text
requested
accepted
rejected
counting_down
cancelled
executing
finished
failed
```

## Device Command

```json
{
  "id": "device_cmd_10001",
  "type": "shutdown",
  "conversationId": "conv_10001",
  "requesterId": "u_10001",
  "targetUserId": "u_10002",
  "status": "requested",
  "countdownSeconds": 30,
  "failureReason": null,
  "createdAt": "2026-06-19T02:20:00Z",
  "updatedAt": "2026-06-19T02:20:00Z"
}
```

## Safety Rules

- The receiver must explicitly accept the shutdown request.
- The receiver must be able to cancel during countdown.
- The backend must write operation logs.
- Clients must display status as device command UI, not as remote desktop control.
