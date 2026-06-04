# Transport Adapters

<cite>
**Referenced Files in This Document**
- [packages/kkrpc/src/interface.ts](file://packages/kkrpc/src/interface.ts)
- [packages/kkrpc/src/adapters/websocket.ts](file://packages/kkrpc/src/adapters/websocket.ts)
- [packages/kkrpc/mod.ts](file://packages/kkrpc/mod.ts)
- [packages/kkrpc/package.json](file://packages/kkrpc/package.json)
- [packages/kkrpc/tsdown.config.ts](file://packages/kkrpc/tsdown.config.ts)
</cite>

## Table of Contents

1. [Adapter Contract](#adapter-contract)
2. [Adapter Families](#adapter-families)
3. [Capabilities](#capabilities)
4. [Packaging Strategy](#packaging-strategy)

## Adapter Contract

Every adapter presents the same `IoInterface`: a name, async `read`, async `write`, event listener
registration, optional capabilities, and optional destroy hooks. This keeps the RPC protocol
independent from WebSocket, stdio, browser postMessage, Electron IPC, Tauri sidecars, and broker
semantics.

**Section sources**

- [packages/kkrpc/src/interface.ts](file://packages/kkrpc/src/interface.ts#L29-L45)
- [packages/kkrpc/src/adapters/websocket.ts](file://packages/kkrpc/src/adapters/websocket.ts#L13-L125)
- [packages/kkrpc/src/adapters/websocket.ts](file://packages/kkrpc/src/adapters/websocket.ts#L154-L220)

## Adapter Families

The main entry point exports worker, Bun, Node, WebSocket, HTTP, Tauri, Hono WebSocket, Elysia
WebSocket, Deno, relay, validation, and middleware modules. Additional subpath exports provide
Chrome Extension, Socket.IO, RabbitMQ, Kafka, Redis Streams, NATS, Electron utility process,
Electron IPC, and inspector support.

**Section sources**

- [packages/kkrpc/mod.ts](file://packages/kkrpc/mod.ts#L27-L45)
- [packages/kkrpc/package.json](file://packages/kkrpc/package.json#L48-L178)
- [packages/kkrpc/tsdown.config.ts](file://packages/kkrpc/tsdown.config.ts#L3-L18)

## Capabilities

Capability declarations tell the channel whether it can send structured clone objects and
transferable values. String-only adapters advertise no transfer support; structured-clone transports
can opt into zero-copy transfer and list known transfer types.

**Section sources**

- [packages/kkrpc/src/interface.ts](file://packages/kkrpc/src/interface.ts#L7-L27)
- [packages/kkrpc/src/adapters/websocket.ts](file://packages/kkrpc/src/adapters/websocket.ts#L23-L26)
- [packages/kkrpc/src/adapters/websocket.ts](file://packages/kkrpc/src/adapters/websocket.ts#L160-L163)

## Packaging Strategy

Adapter-specific packages are optional peer dependencies rather than unconditional runtime
dependencies. This keeps installs smaller and shifts responsibility for broker, Socket.IO, Tauri,
and WebSocket server packages to consumers who import those adapter paths.

**Section sources**

- [packages/kkrpc/package.json](file://packages/kkrpc/package.json#L180-L238)
- [packages/kkrpc/tsdown.config.ts](file://packages/kkrpc/tsdown.config.ts#L23-L34)
- [.journal/2026-02-07.md](file://.journal/2026-02-07.md#L48-L87)
