# kkrpc

面向 TypeScript 的双向 RPC 库，支持 Node.js、Deno、Bun、浏览器、Electron、Tauri、Chrome 扩展以及消息队列场景。

稳定 API 基于原生 `Transport<RPCMessage>`。主入口 `kkrpc` 保持浏览器安全和轻量；运行时传输、可选 peer dependency 和扩展功能都放在独立子路径中。

## 安装

```bash
pnpm add kkrpc
```

只为实际使用的传输安装可选依赖，例如 `ws`、`hono`、`elysia`、`socket.io`、`amqplib`、`kafkajs`、`ioredis` 或 `@nats-io/transport-node`。

## 基础用法

```ts
import { expose, wrap } from "kkrpc"

const controller = expose(localAPI, serverTransport)
const remote = wrap<RemoteAPI>(clientTransport)

await remote.ping()
controller.dispose()
```

当两端都需要暴露 API，或需要显式管理通道生命周期时，使用 `RPCChannel`：

```ts
import { RPCChannel } from "kkrpc"

const channel = new RPCChannel<LocalAPI, RemoteAPI>(transport, { expose: localAPI })
const remote = channel.getAPI()

await remote.math.add(1, 2)
channel.destroy()
```

## Worker 示例

主线程：

```ts
import { wrap } from "kkrpc"
import { workerTransport } from "kkrpc/worker"

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
const api = wrap<WorkerAPI>(workerTransport(worker))
```

Worker 内部：

```ts
import { expose } from "kkrpc"
import { workerSelfTransport } from "kkrpc/worker"

expose(
	{
		async ping() {
			return "pong"
		}
	},
	workerSelfTransport()
)
```

## WebSocket 示例

```ts
import { wrap } from "kkrpc"
import { webSocketClientTransport } from "kkrpc/ws"

const api = wrap<RemoteAPI>(webSocketClientTransport({ url: "ws://localhost:3000/rpc" }))
```

服务端 WebSocket 集成位于 `kkrpc/ws`、`kkrpc/ws/hono` 和 `kkrpc/ws/elysia`。

## HTTP 示例

```ts
import { createHttpClient } from "kkrpc/http"

const { api, channel } = createHttpClient<RemoteAPI>("http://localhost:3000/rpc")
await api.ping()
channel.destroy()
```

## 校验与中间件

校验和中间件是插件功能，不会被主入口自动引入。

```ts
import { expose } from "kkrpc"
import { middlewarePlugin } from "kkrpc/middleware"
import { validationPlugin } from "kkrpc/validation"

expose(api, transport, {
	plugins: [validationPlugin(validators), middlewarePlugin(interceptors)]
})
```

## 子路径入口

| 入口                     | 用途                       |
| ------------------------ | -------------------------- |
| `kkrpc`                  | 稳定、浏览器安全的核心 API |
| `kkrpc/browser`          | 显式浏览器核心入口         |
| `kkrpc/transport`        | 传输组合基础设施           |
| `kkrpc/codecs`           | 内置 JSON/object codecs    |
| `kkrpc/worker`           | Web Worker 传输            |
| `kkrpc/stdio`            | Node/Deno/Bun stdio 传输   |
| `kkrpc/http`             | HTTP client 与 handler     |
| `kkrpc/ws`               | WebSocket 传输             |
| `kkrpc/ws/hono`          | Hono WebSocket 集成        |
| `kkrpc/ws/elysia`        | Elysia WebSocket 集成      |
| `kkrpc/iframe`           | iframe 传输                |
| `kkrpc/chrome-extension` | Chrome extension port 传输 |
| `kkrpc/electron`         | Electron 传输              |
| `kkrpc/tauri`            | Tauri 传输                 |
| `kkrpc/socketio`         | Socket.IO 传输             |
| `kkrpc/rabbitmq`         | RabbitMQ 传输              |
| `kkrpc/kafka`            | Kafka 传输                 |
| `kkrpc/redis-streams`    | Redis Streams 传输         |
| `kkrpc/nats`             | NATS 传输                  |
| `kkrpc/validation`       | Standard Schema 校验插件   |
| `kkrpc/middleware`       | 中间件插件                 |
| `kkrpc/superjson`        | SuperJSON codecs           |
| `kkrpc/relay`            | 传输中继 helper            |
| `kkrpc/inspector`        | 原生 inspector helper      |

## 迁移

破坏性迁移说明见 `BREAKING_MIGRATION.md`。
