# MyMeet backend integration contract

The frontend connects to `NEXT_PUBLIC_BACKEND_WS_URL` and falls back to `ws://localhost:8080/ws`. The Spring Boot application should expose a STOMP endpoint at `/ws`, enable the simple broker for `/topic`, and route application destinations under `/app`.

## Room lifecycle

Subscribe to `/topic/meet/{roomId}` after connect. Publish:

- `/app/meet/join`: `{ "roomId": "demo", "participantId": "uuid", "name": "Nora" }`
- `/app/meet/leave`: `{ "roomId": "demo", "participantId": "uuid", "name": "Nora" }`
- `/app/meet/chat`: `{ "roomId": "demo", "participantId": "uuid", "name": "Nora", "message": "Hello" }`

Room events should be broadcast to the room topic. Join/leave events may use `type` or `event` values such as `participant-joined`, `participant-left`, `JOIN`, or `LEAVE`. Chat events should use `type: "chat"` and include `name` plus `text` or `message`.

## WebRTC signaling

The frontend publishes signaling messages to:

- `/app/webrtc/offer`
- `/app/webrtc/answer`
- `/app/webrtc/ice`

Each message includes `roomId`, `from`, `to`, and either `sdp` or `candidate`. Broadcast signaling to `/topic/meet/{roomId}` or route directly to the target participant. The frontend accepts common `type`/`event` values (`offer`, `answer`, `ice`) and ignores messages targeted at another participant.

## CORS and configuration

Allow the deployed MyMeet origin and local development origin in Spring WebSocket/STOMP configuration. Set `NEXT_PUBLIC_BACKEND_WS_URL` to the deployed `wss://.../ws` endpoint in production; do not hardcode deployment URLs in the frontend.
