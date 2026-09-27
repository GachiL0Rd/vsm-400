# Game server skeleton

`src/server` is the composition root for authoritative `simulation`, platform
integration, HTTP/static hosting and the WebSocket transport. It deliberately
does not define browser wire DTOs: the parallel `common`/protocol patch plugs
into `GameProtocolAdapter` and invokes `GameSessionHost` after decoding its
own authenticated hello/resume messages.

Run the standalone shell with `npm run server`. Without `PLATFORM_API_URL` and
`PLATFORM_SERVICE_TOKEN`, it uses `MockPlatformGateway`; configuration is read
once by `parseServerConfig`.

The current shell serves `GET /health`, optionally static client assets, and
upgrades `/game-ws`. Until a protocol adapter is installed, upgraded sockets
close with code `1008` rather than accepting unauthenticated payloads.
