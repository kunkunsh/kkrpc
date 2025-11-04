<div align="center">

# 🚀 kkrpc

## TypeScript 优先的 RPC 库

[![NPM Version](https://img.shields.io/npm/v/kkrpc?style=for-the-badge&logo=npm)](https://www.npmjs.com/package/kkrpc)
[![JSR Version](https://img.shields.io/jsr/v/@kunkun/kkrpc?style=for-the-badge&logo=deno)](https://jsr.io/@kunkun/kkrpc)
[![License](https://img.shields.io/npm/l/kkrpc?style=for-the-badge)](https://github.com/kunkunsh/kkrpc/blob/main/LICENSE)
[![Downloads](https://img.shields.io/npm/dm/kkrpc?style=for-the-badge&logo=npm)](https://www.npmjs.com/package/kkrpc)
[![GitHub stars](https://img.shields.io/github/stars/kunkunsh/kkrpc?style=for-the-badge&logo=github)](https://github.com/kunkunsh/kkrpc)
[![Typedoc Documentation](https://img.shields.io/badge/Docs-Typedoc-blue?style=for-the-badge&logo=typescript)](https://kunkunsh.github.io/kkrpc/)
[![Excalidraw Diagrams](https://img.shields.io/badge/Diagrams-Excalidraw-orange?style=for-the-badge&logo=drawio)](https://excalidraw.com/#json=xp6GbAJVAx3nU-h3PhaxW,oYBNvYmCRsQ2XR3MQo73Ug)

</div>

> 本项目最初是为 Tauri 应用 ([kunkun](https://github.com/kunkunsh/kunkun)) 构建扩展系统而创建的。
>
> 它也可以用于其他类型的应用，所以我将其作为独立包开源。

**进程、worker 和上下文之间的无缝双向通信**

像调用本地函数一样调用远程函数，具有完整的 TypeScript 类型安全和自动补全支持。

**类似于 Comlink 但支持双向通信**，并支持多种环境 - 客户端和服务器都可以在 Node.js、Deno、Bun 和浏览器环境中暴露函数供对方调用。

[**快速开始**](#-快速开始) • [**文档**](https://kunkunsh.github.io/kkrpc/) • [**示例**](#-示例) • [**API 参考**](https://jsr.io/@kunkun/kkrpc/doc)

<div align="center">

<img src="https://imgur.com/vR3Lmv0.png" style="max-height: 200px; margin: 10px;"/>
<img src="https://i.imgur.com/zmOHNfu.png" style="max-height: 250px; margin: 10px;"/>
<img src="https://imgur.com/u728aVv.png" style="max-height: 400px; margin: 10px;"/>
<img src="https://i.imgur.com/Gu7jH1v.png" style="max-height: 300px; margin: 10px;"/>

</div>

---

## 🌟 为什么选择 kkrpc？

在拥挤的 RPC 领域中，kkrpc 通过提供**真正的跨运行时兼容性**而脱颖而出，同时不牺牲类型安全或开发体验。与 tRPC（仅 HTTP）或 Comlink（仅浏览器）不同，kkrpc 支持 Node.js、Deno、Bun 和浏览器环境之间的无缝通信。

## ✨ 特性

<div align="center">

| 特性                     | 描述                                                    |
| --------------------------- | -------------------------------------------------------------- |
| **🔄 跨运行时**        | 在 Node.js、Deno、Bun、浏览器等环境中无缝工作 |
| **🛡️ 类型安全**            | 完整的 TypeScript 推断和 IDE 自动补全支持       |
| **↔️ 双向**        | 两个端点可以同时暴露和调用 API         |
| **🏠 属性访问**      | 使用点表示法进行远程 getter/setter (`await api.prop`)    |
| **💥 错误保留**   | 跨 RPC 边界保留完整错误对象                   |
| **🌐 多种传输协议**  | stdio、HTTP、WebSocket、postMessage、Chrome 扩展         |
| **📞 回调支持**     | 远程函数可以接受回调函数                 |
| **🔗 嵌套调用**         | 深度方法链如 `api.math.operations.calculate()`    |
| **📦 自动序列化**   | 智能的 JSON/superjson 检测                           |
| **⚡ 零配置**          | 无需架构文件或代码生成                    |
| **🚀 可传输对象** | 大数据的零拷贝传输（快 40-100 倍）            |

</div>

## 🌍 支持的环境

<div align="center">

```mermaid
graph LR
    A[kkrpc] --> B[Node.js]
    A --> C[Deno]
    A --> D[Bun]
    A --> E[Browser]
    A --> F[Chrome Extension]
    A --> G[Tauri]

    B -.-> H[stdio]
    C -.-> H
    D -.-> H

    E -.-> I[postMessage]
    E -.-> J[Web Workers]
    E -.-> K[iframes]

    F -.-> L[Chrome Ports]

    G -.-> M[Shell Plugin]

    style A fill:#ff6b6b,stroke:#333,stroke-width:2px
```

</div>

### 📡 传输协议

| 传输协议            | 使用场景                                          | 支持的运行时                     |
| -------------------- | ------------------------------------------------- | -------------------------------------- |
| **stdio**            | 进程间通信                  | Node.js ↔ Deno ↔ Bun                 |
| **postMessage**      | 浏览器上下文通信                     | Browser ↔ Web Workers ↔ iframes      |
| **HTTP**             | Web API 通信                             | 所有运行时                           |
| **WebSocket**        | 实时通信                           | 所有运行时                           |
| **Hono WebSocket**   | 与 Hono 框架的高性能 WebSocket    | Node.js, Deno, Bun, Cloudflare Workers |
| **Socket.IO**        | 增强的实时通信，支持房间/命名空间          | 所有运行时                           |
| **Elysia WebSocket** | 与现代 TypeScript 优先 Elysia 框架的 WebSocket 集成 | Bun, Node.js, Deno                     |
| **Chrome Extension** | 扩展组件通信                 | Chrome Extension 上下文              |
| **RabbitMQ**         | 消息队列通信                       | Node.js, Deno, Bun                   |
| **Redis Streams**    | 具有持久性的流式消息传递           | Node.js, Deno, Bun                   |
| **Kafka**            | 分布式流处理平台                    | Node.js, Deno, Bun                   |

**kkrpc** 设计的核心在于 `RPCChannel` 和 `IoInterface`。

- `RPCChannel` 是双向 RPC 通道
- `LocalAPI` 是要暴露给通道另一端的 API
- `RemoteAPI` 是通道另一端暴露的 API，可在本地调用
- `rpc.getAPI()` 返回一个 `RemoteAPI` 类型的对象，可以在本地像普通本地函数调用一样调用
- `IoInterface` 是为不同环境实现 IO 的接口。实现被称为适配器。
  - 例如，对于 Node 进程与 Deno 进程通信，我们需要实现 `IoInterface` 的 `NodeIo` 和 `DenoIo` 适配器。它们共享相同的 stdio 管道 (`stdin/stdout`)。
  - 在 Web 中，我们有用于 web worker 的 `WorkerChildIO` 和 `WorkerParentIO` 适配器，用于 iframe 的 `IframeParentIO` 和 `IframeChildIO` 适配器。

> 在浏览器中，从 `kkrpc/browser` 而不是 `kkrpc` 导入，Deno 适配器使用 node:buffer，在浏览器中不工作。

```ts
interface IoInterface {
	name: string
	read(): Promise<Buffer | Uint8Array | string | null> // 读取输入
	write(data: string): Promise<void> // 写入输出
}

class RPCChannel<
	LocalAPI extends Record<string, any>,
	RemoteAPI extends Record<string, any>,
	Io extends IoInterface = IoInterface
> {}
```

## 序列化

kkrpc 支持两种消息传输序列化格式：

- `json`: 标准 JSON 序列化
- `superjson`: 增强的 JSON 序列化，支持更多数据类型，如 Date、Map、Set、BigInt 和 Uint8Array（自 v0.2.0 起默认）

您可以在创建新的 RPCChannel 时指定序列化格式：

```ts
// 使用默认序列化（superjson）
const rpc = new RPCChannel(io, { expose: apiImplementation })

// 明确使用 superjson 序列化（为了清晰推荐）
const rpc = new RPCChannel(io, {
	expose: apiImplementation,
	serialization: { version: "superjson" }
})

// 使用标准 JSON 序列化（为了向后兼容）
const rpc = new RPCChannel(io, {
	expose: apiImplementation,
	serialization: { version: "json" }
})
```

为了向后兼容，接收方将自动检测序列化格式，因此旧客户端可以与新服务器通信，反之亦然。

## 🚀 快速开始

### 安装

<div align="center">

```bash
# npm
npm install kkrpc

# yarn
yarn add kkrpc

# pnpm
pnpm add kkrpc

# deno
import { RPCChannel } from "jsr:@kunkun/kkrpc"
```

</div>

### 基本示例

<div align="center">

```typescript
// server.ts
import { NodeIo, RPCChannel } from "kkrpc"

const api = {
	greet: (name: string) => `Hello, ${name}!`,
	add: (a: number, b: number) => a + b
}

const rpc = new RPCChannel(new NodeIo(process.stdin, process.stdout), {
	expose: api
})
```

```typescript
// client.ts
import { spawn } from "child_process"
import { NodeIo, RPCChannel } from "kkrpc"

const worker = spawn("deno", ["run", "server.ts"])
const rpc = new RPCChannel(new NodeIo(worker.stdout, worker.stdin))
const api = rpc.getAPI<typeof api>()

console.log(await api.greet("World")) // "Hello, World!"
console.log(await api.add(5, 3)) // 8
```

</div>

## 📚 示例

以下是一些让您快速开始的简单示例。

### Stdio 示例

```ts
import { NodeIo, RPCChannel } from "kkrpc"
import { apiMethods } from "./api.ts"

const stdio = new NodeIo(process.stdin, process.stdout)
const child = new RPCChannel(stdio, { expose: apiMethods })
```

```ts
import { spawn } from "child_process"

const worker = spawn("bun", ["scripts/node-api.ts"])
const io = new NodeIo(worker.stdout, worker.stdin)
const parent = new RPCChannel<{}, API>(io)
const api = parent.getAPI()

expect(await api.add(1, 2)).toBe(3)
```

### 属性访问示例

kkrpc 支持跨 RPC 边界的直接属性访问和变异：

```ts
// 定义带有属性的 API
interface API {
	add(a: number, b: number): Promise<number>
	counter: number
	settings: {
		theme: string
		notifications: {
			enabled: boolean
		}
	}
}

const api = rpc.getAPI<API>()

// 属性 getter（使用 await 进行远程访问）
const currentCount = await api.counter
const theme = await api.settings.theme
const notificationsEnabled = await api.settings.notifications.enabled

// 属性 setter（直接赋值）
api.counter = 42
api.settings.theme = "dark"
api.settings.notifications.enabled = true

// 验证更改
console.log(await api.counter) // 42
console.log(await api.settings.theme) // "dark"
```

### 增强的错误保留

kkrpc 跨 RPC 边界保留完整的错误信息：

```ts
// 自定义错误类
class DatabaseError extends Error {
	constructor(
		message: string,
		public code: number,
		public query: string
	) {
		super(message)
		this.name = "DatabaseError"
	}
}

// 具有抛出错误方法的 API
const apiImplementation = {
	async getUserById(id: string) {
		if (!id) {
			const error = new DatabaseError("Invalid user ID", 400, "SELECT * FROM users WHERE id = ?")
			error.timestamp = new Date().toISOString()
			error.requestId = generateRequestId()
			throw error
		}
		// ... 正常逻辑
	}
}

// 客户端错误处理
try {
	await api.getUserById("")
} catch (error) {
	// 所有错误属性都被保留：
	console.log(error.name) // "DatabaseError"
	console.log(error.message) // "Invalid user ID"
	console.log(error.code) // 400
	console.log(error.query) // "SELECT * FROM users WHERE id = ?"
	console.log(error.stack) // 完整堆栈跟踪
	console.log(error.timestamp) // ISO 时间戳
	console.log(error.requestId) // 请求 ID
}
```

### Web Worker 示例

```ts
import { RPCChannel, WorkerChildIO, type DestroyableIoInterface } from "kkrpc"

const worker = new Worker(new URL("./scripts/worker.ts", import.meta.url).href, { type: "module" })
const io = new WorkerChildIO(worker)
const rpc = new RPCChannel<API, API, DestroyableIoInterface>(io, { expose: apiMethods })
const api = rpc.getAPI()

expect(await api.add(1, 2)).toBe(3)
```

```ts
import { RPCChannel, WorkerParentIO, type DestroyableIoInterface } from "kkrpc"

const io: DestroyableIoInterface = new WorkerChildIO()
const rpc = new RPCChannel<API, API, DestroyableIoInterface>(io, { expose: apiMethods })
const api = rpc.getAPI()

const sum = await api.add(1, 2)
expect(sum).toBe(3)
```

### 可传输对象示例

kkrpc 支持使用浏览器原生可传输对象进行大型数据结构的零拷贝传输。这为大型二进制数据传输提供了 40-100 倍的性能提升。

```ts
import { RPCChannel, transfer, WorkerParentIO } from "kkrpc/browser"

const worker = new Worker("worker.js")
const io = new WorkerParentIO(worker)
const rpc = new RPCChannel(io)
const api = rpc.getAPI<{
	processBuffer(buffer: ArrayBuffer): Promise<number>
	generateData(size: number): Promise<ArrayBuffer>
}>()

// 创建大缓冲区（10MB）
const buffer = new ArrayBuffer(10 * 1024 * 1024)
console.log("传输前:", buffer.byteLength) // 10485760

// 将缓冲区传输给 worker（零拷贝）
const result = await api.processBuffer(transfer(buffer, [buffer]))
console.log("Worker 处理了:", result, "字节")

// 缓冲区现在被置空（传输了所有权）
console.log("传输后:", buffer.byteLength) // 0

// 从 worker 获取数据（也是传输的）
const newBuffer = await api.generateData(5 * 1024 * 1024)
console.log("从 worker 接收:", newBuffer.byteLength) // 5242880
```

### Hono WebSocket 示例

Hono WebSocket 适配器提供与 Hono 框架高性能 WebSocket 支持的无缝集成。

#### `server.ts`

```ts
import { Hono } from "hono"
import { upgradeWebSocket, websocket } from "hono/bun"
import { createHonoWebSocketHandler } from "kkrpc"
import { apiMethods, type API } from "./api"

const app = new Hono()

app.get(
	"/ws",
	upgradeWebSocket(() => {
		return createHonoWebSocketHandler<API>({
			expose: apiMethods
		})
	})
)

const server = Bun.serve({
	port: 3000,
	fetch: app.fetch,
	websocket
})

console.log(`服务器运行在端口 ${server.port}`)
```

#### `client.ts`

```ts
import { RPCChannel, WebSocketClientIO } from "kkrpc"
import { apiMethods, type API } from "./api"

const clientIO = new WebSocketClientIO({
	url: "ws://localhost:3000/ws"
})

const clientRPC = new RPCChannel<API, API>(clientIO, {
	expose: apiMethods
})

const api = clientRPC.getAPI()

// 测试基本 RPC 调用
console.log(await api.add(5, 3)) // 8
console.log(await api.echo("Hello from Hono!")) // "Hello from Hono!"

// 测试嵌套 API 调用
console.log(await api.math.grade2.multiply(4, 6)) // 24

// 测试属性访问
console.log(await api.counter) // 42
console.log(await api.nested.value) // "hello world"

clientIO.destroy()
```

**Hono WebSocket 特性：**

- **高性能**: 基于 Hono 的超快 WebSocket 实现
- **跨运行时**: 在 Bun、Deno、Node.js 和 Cloudflare Workers 上工作
- **类型安全**: 完整的 TypeScript 支持和 Hono 集成
- **双向**: 客户端和服务器都可以暴露 API
- **框架集成**: 与 Hono 中间件生态系统的无缝集成

**了解更多**: [Hono WebSocket 文档](https://hono.dev/docs/helpers/websocket)

### Elysia WebSocket 示例

Elysia WebSocket 适配器提供与现代 TypeScript 优先的 Elysia 框架及其 uWebSocket 驱动的 WebSocket 支持的无缝集成。

#### `server.ts`

```ts
import { Elysia } from "elysia"
import { ElysiaWebSocketServerIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

// 为 Elysia 特定功能扩展 API
interface ElysiaAPI extends API {
	getConnectionInfo(): Promise<{
		remoteAddress: string | undefined
		query: Record<string, string>
		headers: Record<string, string>
	}>
}

const app = new Elysia()
	.ws("/rpc", {
		open(ws) {
			const io = new ElysiaWebSocketServerIO(ws)
			const elysiaApiMethods: ElysiaAPI = {
				...apiMethods,
				getConnectionInfo: async () => ({
					remoteAddress: io.getRemoteAddress(),
					query: io.getQuery(),
					headers: io.getHeaders()
				})
			}

			const rpc = new RPCChannel<ElysiaAPI, ElysiaAPI>(io, {
				expose: elysiaApiMethods
			})
		},
		message(ws, message) {
			ElysiaWebSocketServerIO.feedMessage(ws, message)
		}
	})
	.listen(3000)

console.log("Elysia 服务器运行在端口 3000")
```

#### `client.ts`

```ts
import { ElysiaWebSocketClientIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

const clientIO = new ElysiaWebSocketClientIO("ws://localhost:3000/rpc")
const clientRPC = new RPCChannel<API, any>(clientIO, {
	expose: apiMethods
})

const api = clientRPC.getAPI()

// 测试基本 RPC 调用
console.log(await api.add(5, 3)) // 8
console.log(await api.echo("Hello from Elysia!")) // "Hello from Elysia!"

// 测试嵌套 API 调用
console.log(await api.math.grade1.add(10, 20)) // 30
console.log(await api.math.grade3.divide(20, 4)) // 5

// 测试 Elysia 特定功能
const connInfo = await api.getConnectionInfo()
console.log("连接自:", connInfo.remoteAddress)
console.log("查询参数:", connInfo.query)
console.log("请求头:", connInfo.headers)

clientIO.destroy()
```

**Elysia WebSocket 特性：**

- **现代框架**: 基于 Elysia 的 TypeScript 优先设计
- **超快**: 由 uWebSocket 驱动以获得最大性能
- **丰富元数据**: 访问连接信息、查询参数和请求头
- **类型安全**: 完整的 TypeScript 推断和自动补全
- **运行时灵活**: 在 Bun、Node.js 和 Deno 上工作
- **开发体验**: 具有工厂函数的简洁 API

**了解更多**: [Elysia WebSocket 文档](https://elysiajs.com/patterns/websocket)

**关键优势：**

- **零拷贝性能**: 无序列化/反序列化开销
- **内存高效**: 所有权传输无需复制
- **自动回退**: 对不可传输传输的优雅降级
- **类型安全**: 完整的 TypeScript 支持

**支持的可传输类型：**

- `ArrayBuffer` - 二进制数据缓冲区
- `MessagePort` - 通信通道
- `ImageBitmap` - 解码的图像数据
- `OffscreenCanvas` - 屏幕外画布渲染
- `ReadableStream`/`WritableStream` - 流数据
- 更多... [参见 MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)

### HTTP 示例

Codesandbox: https://codesandbox.io/p/live/4a349334-0b04-4352-89f9-cf1955553ae7

#### `api.ts`

定义 API 类型和实现。

```ts
export type API = {
	echo: (message: string) => Promise<string>
	add: (a: number, b: number) => Promise<number>
}

export const api: API = {
	echo: (message) => {
		return Promise.resolve(message)
	},
	add: (a, b) => {
		return Promise.resolve(a + b)
	}
}
```

#### `server.ts`

服务器只需要一次设置，然后就不需要再动它了。
所有的 API 实现都在 `api.ts` 中。

```ts
import { HTTPServerIO, RPCChannel } from "kkrpc"
import { api, type API } from "./api"

const serverIO = new HTTPServerIO()
const serverRPC = new RPCChannel<API, API>(serverIO, { expose: api })

const server = Bun.serve({
	port: 3000,
	async fetch(req) {
		const url = new URL(req.url)
		if (url.pathname === "/rpc") {
			const res = await serverIO.handleRequest(await req.text())
			return new Response(res, {
				headers: { "Content-Type": "application/json" }
			})
		}
		return new Response("Not found", { status: 404 })
	}
})
console.log(`服务器启动在端口: ${server.port}`)
```

#### `client.ts`

```ts
import { HTTPClientIO, RPCChannel } from "kkrpc"
import { api, type API } from "./api"

const clientIO = new HTTPClientIO({
	url: "http://localhost:3000/rpc"
})
const clientRPC = new RPCChannel<{}, API>(clientIO, { expose: api })
const clientAPI = clientRPC.getAPI()

const echoResponse = await clientAPI.echo("hello")
console.log("echoResponse", echoResponse)

const sum = await clientAPI.add(2, 3)
console.log("总和: ", sum)
```

### Chrome 扩展示例

对于 Chrome 扩展，使用专用的 `ChromePortIO` 适配器进行可靠的基于端口的通信。

#### `background.ts`

```ts
import { ChromePortIO, RPCChannel } from "kkrpc/chrome-extension"
import type { BackgroundAPI, ContentAPI } from "./types"

const backgroundAPI: BackgroundAPI = {
	async getExtensionVersion() {
		return chrome.runtime.getManifest().version
	}
}

chrome.runtime.onConnect.addListener((port) => {
	if (port.name === "content-to-background") {
		const io = new ChromePortIO(port)
		const rpc = new RPCChannel(io, { expose: backgroundAPI })
		// 处理断开连接
		port.onDisconnect.addListener(() => io.destroy())
	}
})
```

#### `content.ts`

```ts
import { ChromePortIO, RPCChannel } from "kkrpc/chrome-extension"
import type { BackgroundAPI, ContentAPI } from "./types"

const contentAPI: ContentAPI = {
	async getPageTitle() {
		return document.title
	}
}

const port = chrome.runtime.connect({ name: "content-to-background" })
const io = new ChromePortIO(port)
const rpc = new RPCChannel<ContentAPI, BackgroundAPI>(io, { expose: contentAPI })

const backgroundAPI = rpc.getAPI()

// 示例调用
backgroundAPI.getExtensionVersion().then((version) => {
	console.log("扩展版本:", version)
})
```

**Chrome 扩展特性：**

- **基于端口**: 使用 `chrome.runtime.Port` 进行稳定的长期连接。
- **双向**: 两边都可以暴露和调用 API。
- **类型安全**: 完整的 TypeScript API 支持。
- **可靠**: 处理连接生命周期和清理。

### RabbitMQ 示例

RabbitMQ 适配器提供可靠的消息队列通信，支持主题交换和持久化消息传递。

#### `producer.ts`

```ts
import { RabbitMQIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

const rabbitmqIO = new RabbitMQIO({
  url: "amqp://localhost",
  exchange: "kkrpc-exchange",
  exchangeType: "topic",
  durable: true
})

const producerRPC = new RPCChannel<API, API>(rabbitmqIO, {
  expose: apiMethods
})

const api = producerRPC.getAPI()

// 测试基本 RPC 调用
console.log(await api.add(5, 3)) // 8
console.log(await api.echo("Hello from RabbitMQ!")) // "Hello from RabbitMQ!"

rabbitmqIO.destroy()
```

#### `consumer.ts`

```ts
import { RabbitMQIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

const rabbitmqIO = new RabbitMQIO({
  url: "amqp://localhost",
  exchange: "kkrpc-exchange",
  exchangeType: "topic",
  durable: true,
  sessionId: "consumer-session"
})

const consumerRPC = new RPCChannel<API, API>(rabbitmqIO, {
  expose: apiMethods
})

const api = consumerRPC.getAPI()

// 处理来自生产者的消息
console.log(await api.add(10, 20)) // 30
console.log(await api.echo("Hello from consumer!")) // "Hello from consumer!"

rabbitmqIO.destroy()
```

**RabbitMQ 特性：**

- **主题交换**: 具有通配符模式的灵活路由
- **持久化消息**: 消息在代理重启后仍然存在
- **负载均衡**: 多个消费者可以共享工作负载
- **可靠传递**: 确认和重新传递支持
- **会话管理**: 唯一会话防止消息冲突

### Redis Streams 示例

Redis Streams 适配器提供高性能的基于流的消息传递，具有持久性和消费者组支持。

#### `publisher.ts`

```ts
import { RedisStreamsIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

const redisIO = new RedisStreamsIO({
  url: "redis://localhost:6379",
  stream: "kkrpc-stream",
  maxLen: 10000, // 只保留最后 1 万条消息
  maxQueueSize: 1000
})

const publisherRPC = new RPCChannel<API, API>(redisIO, {
  expose: apiMethods
})

const api = publisherRPC.getAPI()

// 测试基本 RPC 调用
console.log(await api.add(7, 8)) // 15
console.log(await api.echo("Hello from Redis Streams!")) // "Hello from Redis Streams!"

// 获取流信息
const streamInfo = await redisIO.getStreamInfo()
console.log("流长度:", streamInfo.length)

redisIO.destroy()
```

#### `subscriber.ts`

```ts
import { RedisStreamsIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

// 使用消费者组进行负载均衡
const redisIO = new RedisStreamsIO({
  url: "redis://localhost:6379",
  stream: "kkrpc-stream",
  consumerGroup: "kkrpc-group",
  consumerName: "worker-1",
  useConsumerGroup: true, // 启用负载均衡
  maxQueueSize: 1000
})

const subscriberRPC = new RPCChannel<API, API>(redisIO, {
  expose: apiMethods
})

const api = subscriberRPC.getAPI()

// 使用负载均衡处理消息
console.log(await api.multiply(4, 6)) // 24
console.log(await api.echo("Hello from subscriber!")) // "Hello from subscriber!"

redisIO.destroy()
```

**Redis Streams 特性：**

- **两种模式**: 发布/订阅（所有消费者）或消费者组（负载均衡）
- **持久性**: 消息存储在 Redis 中，具有可配置的保留期
- **内存保护**: 队列大小限制防止内存问题
- **消费者组**: 具有消息确认的负载均衡
- **流管理**: 用于监控和修剪流的内置工具

### Kafka 示例

Kafka 适配器为大型系统提供具有高吞吐量和容错性的分布式流处理。

#### `producer.ts`

```ts
import { KafkaIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

const kafkaIO = new KafkaIO({
  brokers: ["localhost:9092"],
  topic: "kkrpc-topic",
  clientId: "kkrpc-producer",
  numPartitions: 3,
  replicationFactor: 1,
  maxQueueSize: 1000
})

const producerRPC = new RPCChannel<API, API>(kafkaIO, {
  expose: apiMethods
})

const api = producerRPC.getAPI()

// 测试基本 RPC 调用
console.log(await api.add(12, 18)) // 30
console.log(await api.echo("Hello from Kafka!")) // "Hello from Kafka!"

console.log("主题:", kafkaIO.getTopic())
console.log("会话 ID:", kafkaIO.getSessionId())

kafkaIO.destroy()
```

#### `consumer.ts`

```ts
import { KafkaIO, RPCChannel } from "kkrpc"
import { apiMethods, type API } from "./api"

const kafkaIO = new KafkaIO({
  brokers: ["localhost:9092"],
  topic: "kkrpc-topic",
  clientId: "kkrpc-consumer",
  groupId: "kkrpc-consumer-group",
  fromBeginning: false, // 只读取新消息
  maxQueueSize: 1000
})

const consumerRPC = new RPCChannel<API, API>(kafkaIO, {
  expose: apiMethods
})

const api = consumerRPC.getAPI()

// 处理来自 Kafka 的消息
console.log(await api.divide(100, 4)) // 25
console.log(await api.echo("Hello from Kafka consumer!")) // "Hello from Kafka consumer!"

console.log("主题:", kafkaIO.getTopic())
console.log("组 ID:", kafkaIO.getGroupId())

kafkaIO.destroy()
```

**Kafka 特性：**

- **分布式**: 内置复制和分区
- **高吞吐量**: 为高容量消息流优化
- **容错**: 复制和自动故障转移
- **可扩展**: 具有分区的水平扩展
- **持久性**: 具有可配置保留期的持久消息存储
- **消费者组**: 跨消费者实例的负载均衡

### Tauri 示例

从 Tauri 应用调用 bun/node/deno 进程中的函数，使用 JS/TS。

它允许您在 Tauri 应用中调用 Deno/Bun/Node 进程中的任何 JS/TS 代码，就像使用 Electron 一样。

与 Tauri 官方 shell 插件和 [unlocked shellx plugin](https://github.com/HuakunShen/tauri-plugin-shellx) 的无缝集成。

```ts
import { RPCChannel, TauriShellStdio } from "kkrpc/browser"
import { Child, Command } from "@tauri-apps/plugin-shell"

const localAPIImplementation = {
	add: (a: number, b: number) => Promise.resolve(a + b)
}

async function spawnCmd(runtime: "deno" | "bun" | "node") {
	let cmd: Command<string>
	let process = Child | null = null

	if (runtime === "deno") {
		cmd = Command.create("deno", ["run", "-A", scriptPath])
		process = await cmd.spawn()
	} else if (runtime === "bun") {
		cmd = Command.create("bun", [scriptPath])
		process = await cmd.spawn()
	} else if (runtime === "node") {
		cmd = Command.create("node", [scriptPath])
		process = await cmd.spawn()
	} else {
		throw new Error(`无效运行时: ${runtime}，请选择 deno 或 bun`)
	}

	// 监控 stdout/stderr/close/error 用于调试和错误处理
	cmd.stdout.on("data", (data) => {
		console.log("stdout", data)
	})
	cmd.stderr.on("data", (data) => {
		console.warn("stderr", data)
	})
	cmd.on("close", (code) => {
		console.log("close", code)
	})
	cmd.on("error", (err) => {
		console.error("error", err)
	})

	const stdio = new TauriShellStdio(cmd.stdout, process)
	const stdioRPC = new RPCChannel<typeof localAPIImplementation, RemoteAPI>(stdio, {
		expose: localAPIImplementation
	})

	const api = stdioRPC.getAPI();
	await api
		.add(1, 2)
		.then((result) => {
			console.log("result", result)
		})
		.catch((err) => {
			console.error(err)
		})

	process?.kill()
}
```

我在 `examples/tauri-demo` 中提供了一个示例 tauri 应用。

![示例 Tauri 应用](https://i.imgur.com/nkDwRHk.png)

## 🆚 与替代品的比较

<div align="center">

| 特性                  | kkrpc                                                    | tRPC                           | Comlink                        |
| ------------------------ | -------------------------------------------------------- | ------------------------------ | ------------------------------ |
| **跨运行时**        | ✅ Node.js、Deno、Bun、浏览器                           | ❌ 仅 Node.js/浏览器        | ❌ 仅浏览器                |
| **双向**        | ✅ 两边都可以调用 API                              | ❌ 仅客户端调用服务器    | ✅ 两边都可以调用 API    |
| **类型安全**          | ✅ 完整的 TypeScript 支持                               | ✅ 完整的 TypeScript 支持     | ✅ TypeScript 支持          |
| **传输层**     | ✅ stdio、HTTP、WebSocket、postMessage、Chrome 扩展 | ❌ 仅 HTTP                   | ❌ 仅 postMessage            |
| **错误保留**   | ✅ 完整错误对象                                | ⚠️ 有限的错误序列化 | ⚠️ 有限的错误序列化 |
| **属性访问**      | ✅ 远程 getter/setter                                | ❌ 仅方法                | ❌ 仅方法                |
| **零配置**          | ✅ 无代码生成                                    | ✅ 无代码生成          | ✅ 无代码生成          |
| **回调**            | ✅ 函数参数                                   | ❌ 无回调                | ✅ 函数参数         |
| **可传输对象** | ✅ 零拷贝传输（快 40-100 倍）                  | ❌ 不支持               | ✅ 基本支持               |

</div>

### 何时选择 kkrpc

- **跨进程通信**: 需要在不同运行时之间通信（Node.js ↔ Deno、浏览器 ↔ Node.js 等）
- **扩展系统**: 构建插件架构或扩展系统
- **Tauri 应用**: Tauri 前端和后端进程之间的通信
- **Chrome 扩展**: 内容脚本、背景页面和弹出窗口之间的复杂通信
- **多 Worker 架构**: 协调具有不同职责的多个 web worker
- **桌面应用**: Electron/Tauri 具有多个进程的应用

### 何时选择 tRPC

- **REST API 替换**: 为 Web 应用程序构建类型安全的 API
- **仅 HTTP 通信**: 当您只需要基于 HTTP 的通信时
- **React/Next.js 集成**: 当您需要与 React 生态系统的紧密集成时
- **数据库驱动 API**: 构建传统的客户端-服务器应用程序时

### 何时选择 Comlink

- **仅浏览器应用**: 浏览器中的简单 web worker 通信
- **轻量级需求**: 当您只需要基本的 postMessage 抽象时
- **无跨运行时要求**: 当您的所有代码都在浏览器中运行时
- **简单 Worker 模式**: 当您不需要高级功能如属性访问时

## 🔍 关键词和 SEO

**主要关键词**: RPC、TypeScript、远程过程调用、类型安全、双向、跨运行时

**次要关键词**: Node.js、Deno、Bun、浏览器、Web Worker、Chrome 扩展、Tauri、IPC、进程间通信

**用例**: 扩展系统、插件架构、微服务、Worker 通信、跨上下文通信

## 📦 包信息

<div align="center">

| 平台     | 包         | 链接                                                                                                                                                |
| ------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NPM**      | `kkrpc`         | [![NPM](https://img.shields.io/badge/npm-kkrpc-red?style=flat-square&logo=npm)](https://www.npmjs.com/package/kkrpc)                                |
| **JSR**      | `@kunkun/kkrpc` | [![JSR](https://img.shields.io/badge/jsr-@kunkun/kkrpc-blue?style=flat-square&logo=deno)](https://jsr.io/@kunkun/kkrpc)                             |
| **GitHub**   | 仓库      | [![GitHub](https://img.shields.io/badge/github-kkrpc-black?style=flat-square&logo=github)](https://github.com/kunkunsh/kkrpc)                       |
| **文档**     | Typedoc         | [![文档](https://img.shields.io/badge/docs-typedoc-blue?style=flat-square&logo=typescript)](https://kunkunsh.github.io/kkrpc/)                      |
| **示例** | 代码示例    | [![示例](https://img.shields.io/badge/examples-code-green?style=flat-square&logo=github)](https://github.com/kunkunsh/kkrpc/tree/main/examples) |

</div>

## 🤝 贡献

<div align="center">

**欢迎贡献！** 🎉

请随时提交 Pull Request。对于重大更改，请先开 issue 讨论您想要更改的内容。

[![GitHub issues](https://img.shields.io/github/issues/kunkunsh/kkrpc?style=flat-square&logo=github)](https://github.com/kunkunsh/kkrpc/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/kunkunsh/kkrpc?style=flat-square&logo=github)](https://github.com/kunkunsh/kkrpc/pulls)

</div>

## 📄 许可证

<div align="center">

[![License](https://img.shields.io/npm/l/kkrpc?style=flat-square)](https://github.com/kunkunsh/kkrpc/blob/main/LICENSE)

MIT © [kunkunsh](https://github.com/kunkunsh)

</div>

---

<div align="center">

**⭐ 如果这个仓库对您有帮助，请给它一个星标！**

由 kkrpc 团队用 ❤️ 制作

</div>