---
title: Design
description: Design of kkRPC
sidebar:
  order: 1
---

The design of `kkRPC` is inspired by [JSON-RPC 2.0](https://www.jsonrpc.org/specification) specification and [Comlink](https://github.com/GoogleChromeLabs/comlink).

I borrowed the idea of using proxy to make the API look like local calls from Comlink.
Comlink is designed for iframe and web worker communication.
I was using it in my project [Kunkun](https://github.com/kunkunsh/kunkun) and needed to extend it to support `stdio` communication, so I built [comlink-stdio](https://github.com/huakunshen/comlink-stdio).

Later I encountered some problems with comlink in iframe and couldn't find a good solution. The project seems not maintained.
So I decided to build my own library by building on top of `comlink-stdio` to support more communication protocols (e.g. WebSocket, WebWorker, HTTP, etc.).

The HTTP adapter's single endpoint design is inspired by GraphQL, which also has a single post endpoint for all requests.
Actually, the overall design of `kkRPC` is very similar to GraphQL (i.e. sending query and response in JSON format over another protocol, to a single endpoint).
`kkRPC` is much easier to use though. There is no need to define a schema file or to code generation.

The message structure is different from JSON-RPC 2.0, but similar in concept.

Each message can serve as a request, response or callback. `method` is used to locate the exposed API.

```ts
interface Message<T = any> {
	id: string
	method: string
	args: T
	type: "request" | "response" | "callback" // Add "callback" type
	callbackIds?: string[] // Add callbackIds field
}
```

Since it's not possible to transfer a callback function over any protocol, the channel keeps track of callbacks,
send callback ids to the remote. When the remote "calls" the callback, it's actually returning callback ids,
then the local side will use the ids to find the callback function and call it.

## Adapter

To make `kkRPC` work anywhere, `IoInterface` is introduced. It's a common interface for any bidirectional communication channel.

```ts
interface IoInterface {
	name: string
	read(): Promise<Buffer | Uint8Array | string | null> // Reads input
	write(data: string): Promise<void> // Writes output
}
```

`name` is only used for debugging.

Any environment that can establish a connection should be able to implement `read` and `write` function.
`read` means reading data from the remote; `write` means writing data to the remote.

So as long as the environment can read and write, it can be used as a communication channel.

To adapt to a new environment, simply implement `IoInterface` and pass it to `RPCChannel`.

`RPCChannel` does all the underlying magic, including serialization/deserialization, request-response matching, callback managing, proxy generating, etc.

## Supported Adapters

kkrpc includes adapters for various communication protocols:

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

Each adapter implements the `IoInterface` to provide consistent behavior across different transport protocols while leveraging the unique features of each system.

## Extend to Other Languages

JS/TS has the advantage of dynamic typing and super free syntax which allows proxy, eventually allowing calling remote RPC methods like if the are local
with TypeScript support.

`kkRPC` was created for TypeScript projects, it doesn't have a schema like GraphQL or gRPC's `.proto` file.
This project will be so complicated if I want to do that, code generate for other languages will be a ton of work and I don't want to do that.

Since the underlying protocol is quite simple (similar to JSON-RPC), it's possible to extend to other languages.
Just implement the same IO interface and channel in the target language, it's not too hard.

The problem is, you can't reuse the API type/interface from TypeScript, and there is most likely no proxy support (you will need to write the method names). In this case, I don't think `kkRPC` is a good choice, you lose all the benefits of `kkRPC` (i.e. proxy, TypeScript, intellisense).

If you are sure you need other languages for features like `callback`, then you can implement your own channel and IO adapter.
