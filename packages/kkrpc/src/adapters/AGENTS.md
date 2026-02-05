# kkrpc - ADAPTERS DIRECTORY

**Generated:** 2026-01-17T00:00:00Z
**Commit:** 852e61d
**Branch:** main

## OVERVIEW

22 IoInterface implementations for diverse transport protocols across Node.js, Deno, Bun, Browser, Electron, and message queues.

## ADAPTER_CATEGORIES

| Category                  | Adapters                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| **Process/IPC**           | NodeIo, DenoIo, BunIo                                                                             |
| **Browser/Web**           | WorkerParentIO/ChildIO, IframeParentIO/ChildIO, ChromePortIO                                      |
| **Network**               | WebSocketClientIO/ServerIO, HTTPClientIO/ServerIO                                                 |
| **Framework Integration** | HonoWebSocketIO, ElysiaWebSocketIO, SocketIOClientIO/ServerIO                                     |
| **Enterprise Messaging**  | RabbitMQIO, RedisStreamsIO, KafkaIO, NatsIO                                                       |
| **Electron**              | ElectronIpcMainIO, ElectronIpcRendererIO, ElectronUtilityProcessIO, ElectronUtilityProcessChildIO |
| **Tauri**                 | TauriShellStdio                                                                                   |

## IMPLEMENTATION_PATTERNS

### Core Interface

All adapters implement `IoInterface`: `name`, `read()`, `write()`, `capabilities`, optional `destroy()`/`signalDestroy()`.

### Message Queue Pattern (13/15 adapters)

```typescript
private messageQueue: Array<string | IoMessage> = []
private resolveRead: ((value: string | IoMessage | null) => void) | null = null
async read() {
	if (this.messageQueue.length > 0) return this.messageQueue.shift() ?? null
	return new Promise((resolve) => { this.resolveRead = resolve })
}
```

### Destroy Signal Pattern (7/15 adapters)

```typescript
const DESTROY_SIGNAL = "__DESTROY__"
destroy() { if (this.resolveRead) { this.resolveRead(null); this.resolveRead = null } }
```

**Used in:** Worker, iframe, Chrome extension, WebSocket, Socket.IO, Hono, Elysia

### Pair Patterns

- **Parent/Child (Worker, iframe):** Child initiates, identical message handling
- **Client/Server (WebSocket, HTTP, Socket.IO):** Server accepts, client tracks ready

### Runtime-Specific

- **NodeIo:** Wraps `process.stdin/stdout` streams
- **DenoIo/BunIo:** ReadableStream API, `Bun.write()` for output

### Framework Integration

- **HonoWebSocketIO:** Factory function returns Hono WebSocket handler
- **ElysiaWebSocketIO:** IO class with connection metadata accessors
- **SocketIO:** Wraps socket.io event handlers

### Enterprise Messaging

- **RabbitMQIO:** Topic exchange, unique inbound queues, shared routing key
- **RedisStreamsIO:** Pub/Sub or Consumer Groups (load balancing)
- **KafkaIO:** Partition-based, background consumer feeds queue

### Connection Init

- **iframe:** Child sends `PORT_INIT_SIGNAL` with MessageChannel port
- **WebSocket/Socket.IO:** Client tracks `connected: Promise<void>`
- **Message queues:** Async `connectionPromise`, `read()` blocks until ready

## CAPABILITIES

### Capability Matrix

| Adapter          | structuredClone | transfer | transferTypes                                          |
| ---------------- | --------------- | -------- | ------------------------------------------------------ |
| **Worker**       | ✓               | ✓        | ArrayBuffer, MessagePort, ImageBitmap, OffscreenCanvas |
| **iframe**       | ✓               | ✓        | ArrayBuffer, MessagePort                               |
| **ChromePortIO** | ✓               | ✗        | -                                                      |
| **All others**   | ✗               | ✗        | -                                                      |

### Zero-Copy Transfer

```typescript
// Write: if (message.transfers?.length) this.port.postMessage(message.data, message.transfers)
// Read: if (raw.version === 2) return { data: raw, transfers: raw.__transferredValues ?? [] }
```

## ANTI-PATTERNS

- ❌ Don't use `messageQueue` in synchronous adapters (NodeIo/DenoIo/BunIo)
- ❌ Don't forget to resolve pending `resolveRead` in `destroy()`
- ❌ Don't use `__DESTROY__` directly - use `DESTROY_SIGNAL` constant
- ❌ Don't ignore connection errors - log and handle gracefully
