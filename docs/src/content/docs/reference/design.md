---
title: Design
description: Design of kkRPC
sidebar:
  order: 1
---

The design of `kkRPC` is inspired by the [JSON-RPC 2.0](https://www.jsonrpc.org/specification) request/response model and [Comlink](https://github.com/GoogleChromeLabs/comlink)'s proxy-based developer experience.

I borrowed the idea of using proxy to make the API look like local calls from Comlink.
Comlink is designed for iframe and web worker communication.
I was using it in my project [Kunkun](https://github.com/kunkunsh/kunkun) and needed to extend it to support `stdio` communication, so I built [comlink-stdio](https://github.com/huakunshen/comlink-stdio).

Later I encountered some problems with comlink in iframe and couldn't find a good solution. The project seems not maintained.
So I decided to build my own library by building on top of `comlink-stdio` to support more communication protocols (e.g. WebSocket, WebWorker, HTTP, etc.).

The HTTP adapter's single endpoint design is inspired by GraphQL, which also has a single post endpoint for all requests.
Actually, the overall design of `kkRPC` is very similar to GraphQL (i.e. sending query and response in JSON format over another protocol, to a single endpoint).
`kkRPC` is much easier to use though. There is no required schema file and no required code generation.

The message structure is different from JSON-RPC 2.0, but similar in concept.

Stable kkrpc uses compact request, response, and callback records. Requests locate the exposed API with a path array.

```ts
type Operation = "call" | "get" | "set" | "new"

interface RPCRequest {
	t: "q"
	id: string
	op: Operation
	p: string[]
	a?: unknown[]
	v?: unknown
}

interface RPCResponse {
	t: "r"
	id: string
	v?: unknown
	e?: { n: string; m: string; s?: string }
}

interface RPCCallback {
	t: "cb"
	id: string
	a: unknown[]
}
```

Since it's not possible to transfer a callback function over any protocol, the channel keeps track of callbacks,
sends callback marker objects to the remote, and later routes `t: "cb"` records back to the stored local function.

## Transport

To make `kkRPC` work anywhere, `Transport<RPCMessage>` is the common interface for any bidirectional communication channel.

```ts
interface Transport<TMessage> {
	send(message: TMessage, transfers?: Transferable[]): void | Promise<void>
	subscribe(listener: (message: TMessage) => void): () => void
	close?(): void | Promise<void>
}
```

`send()` writes outbound messages. `subscribe()` receives inbound messages and returns an unsubscribe function.

Any environment that can establish a connection should be able to implement `send` and `subscribe` functions.

So as long as the environment can read and write, it can be used as a communication channel.

To adapt to a new environment, implement `Transport<RPCMessage>` and pass it to `RPCChannel`, `wrap()`, or `expose()`.

`RPCChannel` handles request-response matching, callback routing, proxy generation, error preservation, plugin hooks, and cleanup.

The stable package no longer uses the old `IoInterface` adapter model. Public transports are native `Transport<RPCMessage>` factories exposed through subpath exports such as `kkrpc/stdio`, `kkrpc/ws`, `kkrpc/worker`, and `kkrpc/electron`.

## Supported Transports

kkrpc includes transport factories for various communication protocols:

- **stdio**: Process-to-process communication (Node.js, Deno, Bun)
- **HTTP/HTTPS**: Web API communication
- **WebSocket**: Real-time bidirectional communication
- **Web Worker**: Browser worker communication
- **iframe**: Cross-frame communication
- **Chrome Extension**: Extension component communication
- **Tauri**: Desktop app communication
- **RabbitMQ**: Message queue communication with AMQP
- **Redis Streams**: Stream-based messaging with persistence
- **Kafka**: Distributed streaming platform
- **Hono/Elysia WebSocket**: Framework-specific WebSocket integration
- **Socket.IO**: Enhanced real-time communication

Each transport factory returns a consistent `Transport<RPCMessage>` while leveraging the unique features of each system.

## Entry Point Strategy

The main `kkrpc` entry is browser-safe and intentionally small. Runtime integrations and optional peer dependencies live behind subpath exports.

| Entry | Purpose |
| --- | --- |
| `kkrpc` | Core `RPCChannel`, `wrap`, `expose`, plugin types, and transfer helpers |
| `kkrpc/browser` | Explicit browser-safe core entry |
| `kkrpc/deno` | Deno-friendly core entry |
| `kkrpc/transport` | Transport composition primitives |
| `kkrpc/worker`, `kkrpc/stdio`, `kkrpc/http`, `kkrpc/ws` | Common runtime transports |
| `kkrpc/ws/hono`, `kkrpc/ws/elysia` | Framework-specific WebSocket helpers |
| `kkrpc/validation`, `kkrpc/middleware`, `kkrpc/superjson` | Optional feature plugins and codecs |
| `kkrpc/relay`, `kkrpc/inspector` | Relay and observability helpers |

Removed classic entries include `kkrpc/next*`, `kkrpc/browser-lite`, `kkrpc/browser-mini`, and `kkrpc/electron-ipc`.

## Extend to Other Languages

JS/TS has the advantage of dynamic typing and proxy support, which allows remote methods to look like local calls while still carrying TypeScript types.

`kkRPC` was created for TypeScript projects, it doesn't have a schema like GraphQL or gRPC's `.proto` file.
Adding required schema generation for every language would make the TypeScript package much heavier than its core goal.

Since the underlying protocol is quite simple (similar to JSON-RPC), it's possible to extend to other languages.
Just implement the same message transport and channel in the target language, it's not too hard.

The tradeoff is that other languages cannot reuse TypeScript interfaces directly and often do not have equivalent proxy ergonomics. Language interop clients usually call explicit method paths.

If you are sure you need other languages for features like `callback`, then you can implement your own channel and transport.
