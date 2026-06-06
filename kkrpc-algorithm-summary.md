# kkrpc Algorithm Summary

## Overview

kkrpc is a TypeScript-based RPC library enabling bidirectional communication across runtime environments. The core architecture employs the **Adapter Pattern** and **Proxy Pattern**, abstracting different transport mechanisms behind a unified IO interface. The implementation is split into `RPCChannelCore` (framework-agnostic state machine) and `RPCChannel` (thin wrapper injecting the SuperJSON serialization runtime), allowing lite browser builds to avoid importing SuperJSON.

## Core Architecture

### 1. Core Components

#### RPCChannelCore (`src/channel-core.ts`)

- **Role**: Central state machine managing the full RPC communication lifecycle
- **Key Data Structures**:
  - `pendingRequests`: Map of pending responses (`Record<string, PendingRequest>`)
  - `pendingTimers`: Timeout timers for outgoing calls (`Record<string, ReturnType<typeof setTimeout>>`)
  - `callbacks`: Callback function storage (`Record<string, CallbackFunction>`)
  - `callbackCache`: Callback deduplication cache (`Map<CallbackFunction, string>`)
  - `activeStreams`: Producer-side active outgoing streams (`Map<string, StreamProducerState>`)
  - `streamConsumers`: Consumer-side active incoming streams (`Map<string, StreamConsumerState>`)
  - `messageStr`: Message buffer for handling fragmented string messages
  - `isClosed`: Prevents new outbound calls from hanging after transport close
  - `validators`: Optional runtime validation schemas for the exposed API
  - `interceptors`: Onion-model middleware chain
  - `timeout`: Per-call timeout in ms (0 = no timeout)

#### RPCChannel (`src/channel.ts`)

A 23-line facade extending `RPCChannelCore` with SuperJSON serialization. All shared logic lives in `channel-core.ts`.

#### IoInterface (`src/interface.ts`)

- **Role**: Defines the unified IO abstraction
- **Core Methods**:
  - `read(): Promise<string | IoMessage | null>` — read data
  - `write(message: string | IoMessage): Promise<void>` — write data
  - `on(event: "message", listener): void` — subscribe to incoming messages
  - `on(event: "error", listener): void` — subscribe to transport errors
  - `off(event, listener): void` — unsubscribe
  - `destroy?(): void` — hard cleanup
  - `signalDestroy?(): void` — graceful shutdown signal
- **Capability Declarations (`IoCapabilities`)**:
  - `structuredClone?: boolean` — supports IoMessage objects
  - `transfer?: boolean` — supports zero-copy transfer
  - `transferTypes?: string[]` — known transferable types
  - `broadcast?: boolean` — transport delivers to multiple peers

#### RPCSerializationRuntime (`src/serialization-types.ts`)

Pluggable serialization abstraction enabling the core/lite build split:

```typescript
interface RPCSerializationRuntime {
    encodeMessage<T>(message, options, withTransfers, transferredValues?): EncodedMessage
    decodeMessage<T>(raw: WireFormat): Promise<Message<T>>
    serializeError(error: Error): EnhancedError
    deserializeError(error: EnhancedError): Error
}
```

### 2. Adapter Implementations

Each adapter implements `IoInterface`, connecting kkrpc to different transport layers. The library provides **22 adapter classes** across **23 files**:

#### String-based Adapters

| Adapter | File | Transport |
|---|---|---|
| **NodeIo** | `adapters/node.ts` | Node.js stdio |
| **DenoIo** | `adapters/deno.ts` | Deno stdio |
| **BunIo** | `adapters/bun.ts` | Bun stdio |
| **WebSocketClientIO / WebSocketServerIO** | `adapters/websocket.ts` | WebSocket |
| **HTTPClientIO / HTTPServerIO** | `adapters/http.ts` | HTTP request-response |
| **HonoWebSocketIO** | `adapters/hono-websocket.ts` | Hono WebSocket |
| **ElysiaWebSocketServerIO / ElysiaWebSocketClientIO** | `adapters/elysia-websocket.ts` | Elysia WebSocket |
| **SocketIOClientIO / SocketIOServerIO** | `adapters/socketio.ts` | Socket.IO |
| **RabbitMQIO** | `adapters/rabbitmq.ts` | RabbitMQ topic exchange |
| **RedisStreamsIO** | `adapters/redis-streams.ts` | Redis Streams |
| **KafkaIO** | `adapters/kafka.ts` | Apache Kafka |
| **NatsIO** | `adapters/nats.ts` | NATS messaging |

#### Structured-clone Adapters (zero-copy capable)

| Adapter | File | Transport |
|---|---|---|
| **WorkerParentIO / WorkerChildIO** | `adapters/worker.ts` | Web Workers |
| **IframeParentIO / IframeChildIO** | `adapters/iframe.ts` | iframe messaging |
| **ChromePortIO** | `adapters/chrome-extension.ts` | Chrome Extension ports |
| **TauriShellStdio** | `adapters/tauri.ts` | Tauri shell plugin |
| **ElectronIpcMainIO** | `adapters/electron-ipc-main.ts` | Electron main IPC |
| **ElectronIpcRendererIO** | `adapters/electron-ipc-renderer.ts` | Electron renderer IPC |
| **ElectronUtilityProcessIO** | `adapters/electron.ts` | Electron utility process (main) |
| **ElectronUtilityProcessChildIO** | `adapters/electron-child.ts` | Electron utility process (child) |

## Communication Protocol

### 1. Message Format

```typescript
interface Message<T = unknown> {
    id: string              // UUID unique identifier
    method: string          // Method name or path
    args: T                 // Arguments
    type:                   // Message type
        | "request"
        | "response"
        | "callback"
        | "get"
        | "set"
        | "construct"
        | "stream-chunk"    // Streaming data chunk
        | "stream-end"      // Streaming completion
        | "stream-error"    // Streaming error
        | "stream-cancel"   // Streaming cancellation
    callbackIds?: string[]          // Callback function ID list
    version?: "json" | "superjson"  // Serialization format
    meta?: RPCMessageMetadata       // Out-of-band metadata (tracing, etc.)
    path?: string[]                 // Property access path
    value?: unknown                 // Property set value
    transferSlots?: TransferSlot[]  // Transfer slot metadata
}

interface RPCMessageMetadata {
    traceparent?: string    // W3C trace context
    tracestate?: string     // W3C tracestate
    baggage?: string        // W3C baggage
    requestId?: string      // Application-level request ID
    sessionId?: string      // Session identifier
    runtime?: Record<string, string | number | boolean | null | undefined>
    [key: string]: unknown  // Extensible
}
```

### 2. Serialization Mechanism

#### Dual Format Support

- **JSON**: Standard serialization, backward compatible
- **SuperJSON**: Enhanced serialization supporting Date, Map, Set, BigInt, Uint8Array

#### Auto-Detection

```typescript
// Sender chooses format
const message: Message = {
    id: generateUUID(),
    method: "echo",
    args: ["hello"],
    type: "request"
}

// Receiver auto-detects format
if (message.trimStart().startsWith('{"json":')) {
    const parsed = superjson.parse<Message>(message)
} else {
    const parsed = await decodeJsonWireMessage<Message>(message)
}
```

#### Dual-Mode Encoding

```typescript
type EncodedMessage =
    | { mode: "string"; data: string }           // String-based transports
    | { mode: "structured"; data: WireEnvelope } // Structured-clone transports

interface WireEnvelope {
    version: 2
    payload: Message<unknown>
    transferSlots?: TransferSlot[]
    encoding: "object"
    __transferredValues?: unknown[]
}
```

### 3. Zero-Copy Transfer

#### Transfer Slot Mechanism

```typescript
interface TransferSlot {
    type: "raw" | "handler"
    handlerName?: string
    metadata?: unknown
    token?: string  // Random per-slot token proving the placeholder belongs to this message
}

// Transfer process:
// 1. Detect transferable objects (ArrayBuffer, MessagePort, etc.)
// 2. Create TransferSlot replacing original value
// 3. Collect Transferable objects
// 4. Pass transfer list in postMessage / structured output
// 5. Receiver rebuilds objects from TransferSlots
```

## Core Algorithm Flow

### 1. Remote Method Invocation

```typescript
// Client call
await api.user.create({ name: "Alice" })

// Internal flow:
// 1. Proxy intercept → callMethod("user.create", [{ name: "Alice" }])
// 2. Reject immediately if isClosed
// 3. Generate UUID for request
// 4. Start timeout timer (if configured)
// 5. Process callbacks in arguments → replace with __callback_${id}
// 6. Process transferable objects → create transfer slots
// 7. Serialize message → encodeMessage()
// 8. Send via IO adapter → io.write()
// 9. Wait for response → new Promise<>()
// 10. On write failure → reject pending request immediately
```

### 2. Request Processing Loop (Listener)

```typescript
private async listen(): Promise<void> {
    while (!this.isClosed) {
        // 1. Check adapter destroyed state
        if ("isDestroyed" in this.io && this.io.isDestroyed) {
            this.closeFromTransport(new Error("RPC transport closed"))
            break
        }

        // 2. Read raw data (blocks until data or EOF)
        const incoming = await this.io.read()
        if (incoming === null) {
            this.closeFromTransport(new Error("RPC transport closed"))
            break
        }

        // 3. Dispatch message
        await this.handleIncomingMessage(incoming)
    }
}
```

### 3. Message Dispatch

```typescript
private async processDecodedMessage(parsedMessage: Message): Promise<void> {
    switch (parsedMessage.type) {
        case "response":       this.handleResponse(parsedMessage); break
        case "request":        this.handleRequest(parsedMessage); break
        case "callback":       this.handleCallback(parsedMessage); break
        case "get":            this.handleGet(parsedMessage); break
        case "set":            this.handleSet(parsedMessage); break
        case "construct":      this.handleConstruct(parsedMessage); break
        case "stream-chunk":   this.handleStreamChunk(parsedMessage); break
        case "stream-end":     this.handleStreamEnd(parsedMessage); break
        case "stream-error":   this.handleStreamError(parsedMessage); break
        case "stream-cancel":  this.handleStreamCancel(parsedMessage); break
    }
}
```

### 4. Method Call Execution (handleRequest)

```typescript
private async handleRequest(request: Message): Promise<void> {
    // 1. Rebuild transferred objects
    if (request.transferSlots) {
        args = reconstructValueFromTransfer(args, transferSlots, transferredValues)
    }

    // 2. Navigate to target method
    const methodPath = request.method.split(".")
    let target = this.apiImplementation
    for (let i = 0; i < methodPath.length - 1; i++) {
        target = target[methodPath[i]]
    }
    // On broadcast transports, missing paths are silently ignored (another peer may own the method)

    // 3. Restore callback function arguments
    const processedArgs = args.map(arg => {
        if (typeof arg === "string" && arg.startsWith("__callback__")) {
            const callbackId = arg.slice(12)
            return (...callbackArgs) => this.invokeCallback(callbackId, callbackArgs)
        }
        return arg
    })

    // 4. Input validation (if validators configured)
    const methodValidator = lookupValidator(this.validators, method)
    if (methodValidator?.input) {
        const dataArgs = processedArgs.filter(a => typeof a !== "function")
        const inputResult = await runValidation(methodValidator.input, dataArgs)
        if (inputResult.success === false) {
            this.sendError(id, new RPCValidationError("input", method, inputResult.issues))
            return
        }
        processedArgs = mergeValidatedArgs(processedArgs, inputResult.value)
    }

    // 5. Execute method through interceptor chain
    const invokeHandler = () => targetMethod.apply(target, processedArgs)
    const result = interceptors.length > 0
        ? await runInterceptors(interceptors, ctx, invokeHandler)
        : await invokeHandler()

    // 6. If result is AsyncIterable → stream it
    if (isAsyncIterable(result)) {
        this.sendResponse(id, { __stream: true })
        this.streamResult(id, result, method, methodValidator)
        return
    }

    // 7. Output validation (if configured)
    if (methodValidator?.output) {
        const outputResult = await runValidation(methodValidator.output, result)
        if (outputResult.success === false) {
            this.sendError(id, new RPCValidationError("output", method, outputResult.issues))
            return
        }
        this.sendResponse(id, outputResult.value)
        return
    }

    // 8. Send response
    this.sendResponse(id, result)
}
```

## Streaming

kkrpc supports streaming results from handlers that return `AsyncIterable`. The consumer receives a `for await...of` iterable on the caller side.

### Producer Side

```typescript
// Handler returns an AsyncIterable
const api = {
    listItems: async function* (count: number) {
        for (let i = 0; i < count; i++) {
            yield { index: i, data: `item-${i}` }
        }
    }
}

// kkrpc detects AsyncIterable, sends stream marker, then chunks:
// → response with { __stream: true }
// → stream-chunk { value: { index: 0, data: "item-0" } }
// → stream-chunk { value: { index: 1, data: "item-1" } }
// → stream-end
```

- Per-chunk output validation runs if `methodValidator.output` is defined
- Zero-copy transfer works on individual stream chunks
- Producer tracks active streams in `activeStreams: Map<string, StreamProducerState>`
- `AbortController` enables consumer-initiated cancellation

### Consumer Side

```typescript
// Caller receives an AsyncIterable
const stream = await api.listItems(100)
for await (const item of stream) {
    console.log(item)
}
// break or return() sends stream-cancel to the producer
```

- `streamConsumers: Map<string, StreamConsumerState>` tracks active incoming streams
- Chunks arriving before `next()` are buffered; `next()` calls arriving before chunks are parked
- `stream-cancel` aborts the producer's `AbortController`
- `stream-error` rejects all pending and future `next()` calls

## Proxy System

### Nested Proxy Creation

```typescript
private createNestedProxy(chain: string[] = []): any {
    return new Proxy(() => {}, {
        get: (_target, prop) => {
            if (typeof prop === "string") {
                if (prop !== "then") {
                    // obj.nested.prop → continues chaining
                    return this.createNestedProxy([...chain, prop])
                }
                if (chain.length > 0) {
                    // await obj.prop → fetches remote property
                    const promise = this.getProperty(chain)
                    return promise.then.bind(promise)
                }
            }
            return undefined
        },
        set: (_target, prop, value) => {
            // obj.prop = value → sets remote property
            if (typeof prop === "string") {
                this.setProperty([...chain, prop], value)
                return true
            }
            return false
        },
        apply: (_target, _thisArg, args) => {
            // obj.method() → calls remote method
            return this.callMethod(chain.join("."), args)
        },
        construct: (_target, args) => {
            // new obj.Constructor() → calls remote constructor
            return this.callConstructor(chain.join("."), args)
        }
    })
}
```

### Property Access Handling

```typescript
// Get property
public getProperty(path: string | string[]): Promise<any> {
    if (this.isClosed) return Promise.reject(new Error("RPC channel closed"))

    return new Promise((resolve, reject) => {
        const messageId = generateUUID()
        this.pendingRequests[messageId] = { resolve, reject }
        this.startTimeout(messageId, `get:${path.join(".")}`)

        const message: Message = {
            id: messageId,
            method: "",
            args: {},
            type: "get",
            path: Array.isArray(path) ? path : path.split(".")
        }
        this.sendMessage(message)
    })
}

// Set property (similar, with type: "set" and value field)
```

## Callback Mechanism

### Callback Serialization

```typescript
// Sender: detect and replace callback functions
const argsWithCallbacks = args.map((arg) => {
    if (typeof arg === "function") {
        let callbackId = this.callbackCache.get(arg)
        if (!callbackId) {
            callbackId = generateUUID()
            this.callbacks[callbackId] = arg
            this.callbackCache.set(arg, callbackId)
        }
        return `__callback__${callbackId}`
    }
    return arg
})
```

### Callback Invocation

```typescript
// Receiver: rebuild callback functions
const processedArgs = incomingArgs.map((arg) => {
    if (typeof arg === "string" && arg.startsWith("__callback__")) {
        const callbackId = arg.slice(12)
        return (...callbackArgs: any[]) => {
            this.invokeCallback(callbackId, callbackArgs)
        }
    }
    return arg
})

// Callback execution (sends "callback" type message to sender)
private invokeCallback(callbackId: string, args: any[]): void {
    const message: Message = {
        id: generateUUID(),
        method: callbackId,
        args: processedArgs,
        type: "callback"
    }
    this.sendMessage(message)
}
```

## Runtime Validation

kkrpc embeds the **Standard Schema** interface (no external dependency) for optional runtime validation. Compatible with Zod (v3.24+), Valibot (v1+), ArkType (v2+), and any library implementing the spec.

### Two Patterns

#### Type-First Pattern

Define your API type and implementation as usual, then pass a `validators` map:

```typescript
import { z } from "zod"

const channel = new RPCChannel(io, {
    expose: { add: (a, b) => a + b },
    validators: {
        add: {
            input: z.tuple([z.number(), z.number()]),
            output: z.number()
        }
    }
})
```

#### Schema-First Pattern

Use `defineMethod()` / `defineAPI()` to define handlers with schemas inline. Types are inferred:

```typescript
const api = defineAPI({
    add: defineMethod(
        { input: z.tuple([z.number(), z.number()]), output: z.number() },
        async (a, b) => a + b
    ),
    math: {
        multiply: defineMethod(
            { input: z.tuple([z.number(), z.number()]), output: z.number() },
            async (a, b) => a * b
        )
    }
})

const channel = new RPCChannel(io, {
    expose: api,
    validators: extractValidators(api)
})
```

### Validation Flow

1. Input validation runs **before** the handler, filtering out callback functions from validated args
2. Interceptors run **after** input validation, receiving clean data
3. Output validation runs on the handler's return value
4. For streams, per-chunk output validation runs on each yielded value
5. `RPCValidationError` carries `phase` ("input"/"output"), `method` path, and structured `issues`

### Key Types

```typescript
interface MethodValidators<Args extends any[] = any[], Return = any> {
    input?: StandardSchemaV1<FilterCallbacks<Args>>
    output?: StandardSchemaV1<UnwrapPromise<Return>>
}

type RPCValidators<API> = {
    [K in keyof API]?: API[K] extends (...args: infer A) => infer R
        ? MethodValidators<A, R>
        : API[K] extends Record<string, unknown>
            ? RPCValidators<API[K]>
            : never
}

class RPCValidationError extends Error {
    phase: "input" | "output"
    method: string
    issues: ReadonlyArray<StandardSchemaV1.Issue>
}
```

## Interceptor / Middleware System

Onion-model middleware that wraps handler invocation on the receiving side.

```typescript
interface RPCCallContext {
    id: string                    // Wire request ID
    method: string                // e.g. "math.add"
    args: unknown[]               // After callback restoration + input validation
    meta?: RPCMessageMetadata     // Tracing metadata from wire
    state: Record<string, unknown> // Extensible state bag
}

type RPCInterceptor = (ctx: RPCCallContext, next: () => Promise<unknown>) => Promise<unknown>

// Usage
const channel = new RPCChannel(io, {
    interceptors: [
        async (ctx, next) => {
            console.log(`→ ${ctx.method}`, ctx.args)
            const start = Date.now()
            const result = await next()
            console.log(`← ${ctx.method} (${Date.now() - start}ms)`)
            return result
        }
    ]
})
```

Interceptors run after input validation (so they always see clean data) and before output validation. They can inspect/modify args, transform return values, measure timing, enforce authorization, or throw to abort the call.

## Timeout Support

```typescript
class RPCTimeoutError extends Error {
    method: string
    timeoutMs: number
}

// Configuration
const channel = new RPCChannel(io, { timeout: 5000 }) // 5s timeout per call

// If the remote side doesn't respond within timeout, the promise rejects with RPCTimeoutError
// `isRPCTimeoutError()` type guard works across serialization (uses .name check)
```

- `pendingTimers: Record<string, ReturnType<typeof setTimeout>>` tracks active timers
- Timers are cleared when a response arrives
- `timeout: 0` (default) disables timeout
- Closed channels reject new calls immediately (no need to wait for timeout)

## Error Handling

### Enhanced Error Serialization

```typescript
export function serializeError(error: Error): EnhancedError {
    const enhanced: EnhancedError = {
        name: error.name,
        message: error.message
    }
    if (error.stack) enhanced.stack = error.stack
    if ("cause" in error) enhanced.cause = error.cause
    for (const key in error) {
        if (!["name", "message", "stack", "cause"].includes(key)) {
            enhanced[key] = error[key]
        }
    }
    return enhanced
}

// Deserialization rebuilds a full Error object with all custom properties preserved
```

This ensures `RPCValidationError` and `RPCTimeoutError` survive the wire round-trip — the caller can use `isRPCValidationError()` and `isRPCTimeoutError()` type guards on received errors.

### Write Failure Handling

If `io.write()` fails, the corresponding pending request is immediately rejected rather than waiting for a timeout. This prevents calls from hanging when the transport is broken.

## Adapter-Specific Implementations

### Message Queue Pattern (String-Based)

Many string-based adapters use a message queue pattern:

```typescript
private messageQueue: string[] = []
private resolveRead: ((value: string | null) => void) | null = null
```

### RabbitMQ (Topic Exchange)

```typescript
class RabbitMQIO implements IoInterface {
    private exchange = "kkrpc-exchange"
    private routingKey = "kkrpc.messages"

    async write(message: string): Promise<void> {
        await this.channel.publish(this.exchange, this.routingKey, Buffer.from(message))
    }

    private async connect(): Promise<void> {
        await this.channel.assertQueue(this.inboundQueue, { exclusive: true })
        await this.channel.bindQueue(this.inboundQueue, this.exchange, this.routingKey)
        await this.channel.consume(this.inboundQueue, (msg) => {
            this.handleMessage(msg.content.toString("utf8"))
        })
    }
}
```

### Redis Streams

```typescript
class RedisStreamsIO implements IoInterface {
    async write(message: string): Promise<void> {
        await this.publisher.xadd(this.stream, "*", "data", message)
    }

    private async listenForMessages(): Promise<void> {
        while (!this.isDestroyed) {
            const results = await this.subscriber.xread(
                "BLOCK", this.blockTimeout, "STREAMS", this.stream, "$"
            )
            if (results) {
                const [, messages] = results[0]
                for (const [, fields] of messages) {
                    const messageData = fields.find(([k]) => k === "data")?.[1]
                    if (messageData) this.handleMessage(messageData)
                }
            }
        }
    }
}
```

### Web Workers (Zero-Copy)

```typescript
class WorkerParentIO implements IoInterface {
    capabilities = {
        structuredClone: true,
        transfer: true,
        transferTypes: ["ArrayBuffer", "MessagePort", "ImageBitmap"]
    }

    write(message: string | IoMessage): Promise<void> {
        if (message.transfers?.length > 0) {
            this.worker.postMessage(message.data, message.transfers)
        } else {
            this.worker.postMessage(message.data)
        }
    }
}
```

### Broadcast Transports

Adapters with `capabilities.broadcast === true` deliver the same request to multiple peers. RPCChannel handles this gracefully:
- Peers with no exposed API silently ignore broadcast traffic
- Missing method/property paths on broadcast are silently ignored (another peer may own them)
- Non-broadcast adapters treat these as errors

## Lifecycle Management

### Centralized Close Path

```typescript
private closeFromTransport(error: Error): void {
    if (this.isClosed) return
    this.isClosed = true
    this.rejectPendingRequests(error)   // Reject all waiting outbound calls
    this.abortActiveStreams()           // Abort all producer-side streams
    this.rejectStreamConsumers(error)   // Reject all consumer-side stream waiters
    this.freeCallbacks()                // Clear callback registrations
}
```

### Destroy with Cleanup

```typescript
class RPCChannel {
    destroy(): void {
        this.closeFromTransport(new Error("RPC channel destroyed"))
        if (this.io?.destroy) {
            this.io.destroy()  // Clean up transport resources
        }
    }

    freeCallbacks() {
        this.callbacks = {}
        this.callbackCache.clear()
    }
}
```

### Destroy Signal Pattern

Several adapters use `DESTROY_SIGNAL = "__DESTROY__"` for graceful shutdown: Worker, iframe, Chrome Extension, WebSocket, Socket.IO, Hono, and Elysia.

### signalDestroy()

`IoInterface.signalDestroy()` allows adapters to prepare for shutdown (e.g., flushing buffers) before hard `destroy()`. Distinct from `destroy()` which is the actual cleanup.

## Performance Optimizations

### Message Buffering

```typescript
private bufferString(chunk: string): void {
    this.messageStr += chunk
    const lastChar = this.messageStr[this.messageStr.length - 1]
    const msgsSplit = this.messageStr.split("\n")
    const msgs = lastChar === "\n" ? msgsSplit : msgsSplit.slice(0, -1)
    this.messageStr = lastChar === "\n" ? "" : (msgsSplit.at(-1) ?? "")

    for (const msgStr of msgs.filter(Boolean)) {
        if (msgStr.startsWith("{")) {
            void this.handleMessageStr(msgStr)
        }
    }
}
```

### Callback Deduplication

```typescript
// Cache callback functions to avoid re-registration
let callbackId = this.callbackCache.get(arg)
if (!callbackId) {
    callbackId = generateUUID()
    this.callbacks[callbackId] = arg
    this.callbackCache.set(arg, callbackId)
}
```

### Transfer Object Deduplication

```typescript
// Avoid re-transmitting the same object
if (slotMap.has(value)) {
    const slotIndex = slotMap.get(value)!
    return `${TRANSFER_SLOT_PREFIX}${slotIndex}`
}
```

## Type Safety

### Generic Constraints

```typescript
class RPCChannelCore<
    LocalAPI extends Record<string, any>,   // Local API type constraint
    RemoteAPI extends Record<string, any>,  // Remote API type constraint
    Io extends IoInterface = IoInterface    // IO interface constraint
>
```

### Type Inference

```typescript
const api = rpc.getAPI<typeof localAPI>()
//        ^^^^^ inferred as RemoteAPI
```

## Concurrency Handling

### Async Message Processing

```typescript
// All message processing is async, preventing blocking
private async handleIncomingMessage(raw: string | IoMessage): Promise<void> {
    const message = await decodeMessage(payload)
    await this.processDecodedMessage(message)
}
```

### Promise Per Request

```typescript
// Each request creates an independent Promise
public callMethod(method, args): Promise<void> {
    if (this.isClosed) return Promise.reject(new Error("RPC channel closed"))
    return new Promise((resolve, reject) => {
        const messageId = generateUUID()
        this.pendingRequests[messageId] = { resolve, reject }
        this.startTimeout(messageId, method)
        // ... send message
    })
}
```

## Extensibility Design

### Pluggable Adapters

```typescript
// Any implementation of IoInterface can be used
interface IoInterface {
    name: string
    read(): Promise<string | IoMessage | null>
    write(message: string | IoMessage): Promise<void>
    on(event: "message", listener: (message: string | IoMessage) => void): void
    on(event: "error", listener: (error: Error) => void): void
    off(event: "message" | "error", listener: Function): void
    capabilities?: IoCapabilities
    destroy?(): void
    signalDestroy?(): void
}
```

### Pluggable Serialization Runtime

```typescript
// The serialization runtime is dependency-injected, enabling lite builds
interface RPCSerializationRuntime {
    encodeMessage<T>(...): EncodedMessage
    decodeMessage<T>(...): Promise<Message<T>>
    serializeError(error: Error): EnhancedError
    deserializeError(error: EnhancedError): Error
}
```

### Transfer Handlers

```typescript
// Extensible transfer handler system
for (const [name, handler] of transferHandlers) {
    if (handler.canHandle(value)) {
        const [serialized, handlerTransferables] = handler.serialize(value)
        // ... process transfer
    }
}
```

## Summary

kkrpc's core algorithm can be summarized as:

1. **Unified Abstraction**: IoInterface unifies diverse transport layers
2. **Message-Driven**: Async request-response pattern over messages
3. **Type-Safe**: TypeScript generics ensure compile-time type checking
4. **Bidirectional**: Both sides can expose and call APIs
5. **Zero-Copy**: Transferable object support for high-performance data transfer
6. **Streaming**: AsyncIterable-based streaming with cancellation and per-chunk validation
7. **Runtime Validation**: Standard Schema validation with type-first and schema-first patterns
8. **Interceptors**: Onion-model middleware for cross-cutting concerns
9. **Timeouts**: Per-call timeout with typed `RPCTimeoutError`
10. **Observability**: W3C trace context propagation via `RPCMessageMetadata`
11. **Error Preservation**: Full error object fidelity across serialization
12. **Lifecycle**: Comprehensive resource management, stream cleanup, and graceful shutdown
13. **Extensibility**: Pluggable adapters, serialization runtimes, and transfer handlers

This design enables kkrpc to work seamlessly across Node.js, Deno, Bun, browsers, Electron, Tauri, and Chrome Extensions while maintaining high performance and type safety.
