# Talk Room Protocol

Talk rooms support voice intercom. RTC tokens are generated only by the backend.

## States

```text
idle
ringing
joining
joined
muted
left
closed
failed
```

## Create Flow

```text
client -> POST /talk-rooms
backend -> validate permission
backend -> create talk_room
backend -> generate RTC channel id
backend -> broadcast talk.room_created
client -> POST /talk-rooms/{id}/join
backend -> return RTC params
client -> join RTC channel
```

## Join Response

```json
{
  "talkRoomId": "talk_10001",
  "rtcProvider": "aliyun_artc",
  "channelId": "channel_10001",
  "userId": "u_10001",
  "token": "server_generated_token",
  "expiresAt": "2026-06-19T03:20:00Z"
}
```

Clients must not generate RTC tokens.
