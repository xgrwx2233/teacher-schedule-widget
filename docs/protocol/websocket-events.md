# WebSocket Events

All WebSocket messages use the same envelope:

```json
{
  "event": "message.new",
  "requestId": "uuid",
  "serverSeq": 1024,
  "payload": {}
}
```

## Message Events

```text
message.send
message.ack
message.new
message.read
message.revoke
conversation.sync
conversation.unread_changed
```

## Friend And Group Events

```text
friend.requested
friend.accepted
group.created
group.member_added
group.member_removed
```

## Talk Room Events

```text
talk.room_created
talk.room_joined
talk.room_left
talk.room_closed
```

## Wallpaper Events

```text
wallpaper.task_created
wallpaper.task_accepted
wallpaper.task_rejected
wallpaper.task_finished
```

## Device Command Events

```text
device.shutdown_requested
device.shutdown_accepted
device.shutdown_rejected
device.shutdown_cancelled
device.shutdown_finished
```

## Forbidden Events In This Phase

Do not define or emit:

```text
remote.desktop_control_requested
remote.screen_share_started
remote.keyboard_control_enabled
```
