# kkrpc Algorithm Summary

## 概述 (Overview)

kkrpc stable 是一个 TypeScript-first 的双向 RPC 库。当前稳定架构以 `RPCChannel` 和 `Transport<RPCMessage>` 为核心，使用紧凑 JSON 消息、Proxy 远程 API、插件钩子、运行时校验、中间件以及可选 transferable 支持。旧的公开适配器接口不是 stable API 的核心抽象。

## 核心组件 (Core Components)

### RPCChannel (`packages/kkrpc/src/core/channel.ts`)

`RPCChannel<LocalAPI, RemoteAPI>` 管理 RPC 状态机：

- `pending`: 保存等待响应的 outbound request。
- `callbacks`: 保存本地 callback 参数，供远端回调。
- `destroyed`: 防止销毁后继续发起调用，并在销毁时拒绝 pending 调用。
- `supportsTransfer`: 只有 transport 声明支持 transfer 时才转发 transferable。
- `timeout`: 单次调用超时，默认 `30_000` ms；非正数表示禁用超时。
- `plugins`: request、handler、response、error 钩子，用于 validation、middleware、inspector 等功能。

构造函数会订阅 transport，收到消息后根据紧凑字段 `t` 分发处理。

### Transport (`packages/kkrpc/src/core/transport.ts`)

stable transport 是面向消息的小接口：

```typescript
interface Transport<T> {
	capabilities?: TransportCapabilities
	send(message: T, transferables?: Transferable[]): void | Promise<void>
	subscribe(listener: (message: T) => void): () => void
	close?(): void
}
```

`createTransport()` 将底层 `Platform<Wire>` 与 `Codec<Message, Wire>` 组合起来，使 IO 细节和 RPC 消息编码解耦。

### Stable Entry Points

- `kkrpc`: `RPCChannel`、`wrap`、`expose`、`dispose`、`transfer` 等核心导出。
- `kkrpc/browser`: browser-safe 核心导出。
- `kkrpc/stdio`: `nodeStdioTransport()` 和 `stdioJsonTransport()`。
- `kkrpc/ws`: `webSocketTransport()` 和 `webSocketClientTransport()`。
- `kkrpc/http`: HTTP client/server transport helpers。
- `kkrpc/worker`、`kkrpc/iframe`、`kkrpc/chrome-extension` 等子路径提供其他原生 transport factory。

## Stable Protocol

stable 消息定义在 `packages/kkrpc/src/core/protocol.ts`：

```typescript
type RPCOperation = "call" | "get" | "set" | "new"

interface RPCRequest {
	t: "q"
	id: string
	op: RPCOperation
	p: string[]
	a?: unknown[]
	v?: unknown
}

interface RPCResponse {
	t: "r"
	id: string
	v?: unknown
	e?: { n: string; m: string; s?: string; [key: string]: unknown }
}

interface RPCCallback {
	t: "cb"
	id: string
	a: unknown[]
}
```

stable 协议目前没有一等 remote iterator 或 stream 消息类型。需要连续进度或数据时，应使用 callback 参数、事件型 transport、轮询，或显式返回 chunk/result 数组，直到原生 streaming 有协议和测试覆盖。

## 请求流程 (Request Flow)

### 远程调用 (Remote Call)

```typescript
const api = wrap<RemoteAPI>(transport)
await api.user.create({ name: "Alice" })
```

内部流程：

1. 嵌套 Proxy 捕获 path `['user', 'create']` 和 operation `call`。
2. `RPCChannel` 创建 request id，并保存 pending promise。
3. callback 参数编码成 callback envelope，并存入 `callbacks`。
4. `transfer()` 标记的值只在 transport 支持 transfer 时走 transferable 路径。
5. channel 通过 transport 发送 `{ t: 'q', id, op: 'call', p, a }`。
6. 超时计时器在未收到响应时 reject 一个 `name` 为 `RPCTimeoutError` 的 `Error`。

### 处理入站请求 (Incoming Request)

1. 解码参数 envelope，恢复普通值和 callback stub。
2. 执行 plugin `onRequest` hooks。
3. 在本地 exposed API 上解析目标 path。
4. 用 plugin `wrapHandler` hooks 包裹实际 handler。
5. 执行 plugin `onResponse` hooks，并发送 `{ t: 'r', id, v }`。
6. 任一步骤抛错时，执行 plugin `onError` hooks，并发送 `{ t: 'r', id, e }`。

### 响应处理 (Response Handling)

response 通过 `id` 找到 pending request，清理 timeout，然后用 `v` resolve，或用 `e.n`、`e.m`、`e.s` 重建 `Error` 后 reject。

### 回调处理 (Callback Handling)

函数参数会编码为 callback envelope。远端调用 callback stub 时发送 `{ t: 'cb', id, a }`。拥有该 callback 的 channel 根据 `id` 找到本地函数，并用解码后的参数调用。

## Proxy 语义 (Proxy Semantics)

- 属性访问扩展 path。
- `await` 非根属性执行 `get`。
- 赋值执行 fire-and-forget `set`。
- 调用 proxy 执行 `call`。
- `new` proxy 执行 `new` operation。

## 插件、校验和中间件 (Plugins, Validation, Middleware)

插件是 stable 扩展点。validation 和 middleware 都通过插件实现，而不是写死在 channel 内部。

```typescript
interface RPCPlugin {
	onRequest?(ctx): void | Promise<void>
	wrapHandler?(ctx, next): unknown | Promise<unknown>
	onResponse?(ctx): void | Promise<void>
	onError?(ctx): void | Promise<void>
}
```

validation plugin 可以校验输入和输出 schema。middleware plugin 可以记录日志、做鉴权、限流、转换结果，或附加 per-request state。

## Transferables

`transfer(value, descriptor?)` 会在 WeakMap 中标记对象。请求或响应编码时，`RPCChannel` 消耗 descriptor；只有 `transport.capabilities?.transfer === true` 时才把 transferable 传给 `send()`。不支持 transfer 的 transport 会自动走普通 codec 路径。

## Transport 示例 (Transport Examples)

### Stdio

`nodeStdioTransport()` 绑定 `process.stdin` 和 `process.stdout`，使用 JSON-line `RPCMessage`。`stdioJsonTransport({ readable, writable })` 支持自定义 Node-style streams。

### WebSocket

`webSocketTransport(socket)` 用 `JSON.stringify` 序列化每个 `RPCMessage`，支持 browser-style 和 Node `ws` 事件，并在 socket open 前缓存 outbound message。`webSocketClientTransport({ url })` 创建客户端 WebSocket transport。

### HTTP

HTTP transport 为每个 RPC request 使用 request/response 语义，并把 RPC timeout error 映射为 HTTP 504。

## 错误处理 (Error Handling)

错误会序列化为包含 name、message、stack 和 enumerable custom fields 的紧凑记录。远端错误会恢复成 `Error`，并还原原始 `name`。

写入失败会立即拒绝对应 pending request。销毁 channel 会取消订阅、拒绝所有 pending 调用、清空 callbacks，并在 transport 支持时关闭 transport。

## 当前 Stable 限制 (Current Stable Limitations)

- 没有一等 remote iterator 或 stream protocol。
- 没有公开稳定的 legacy adapter layer。
- 跨语言实现应优先实现 compact JSON `RPCMessage` 协议。
