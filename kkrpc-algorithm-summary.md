# kkrpc Algorithm Summary

## 概述 (Overview)

kkrpc 是一个基于 TypeScript 的 RPC 库，实现了跨运行时环境的双向通信。核心架构采用了 **适配器模式 (Adapter Pattern)** 和 **代理模式 (Proxy Pattern)**，通过统一的 IO 接口抽象了不同的通信机制。

## 核心架构 (Core Architecture)

### 1. 核心组件 (Core Components)

#### RPCChannel (`src/channel.ts`)

- **职责**: 中央调度器，管理 RPC 通信的整个生命周期
- **关键数据结构**:
  - `pendingRequests`: 等待响应的请求映射表 (`Record<string, PendingRequest>`)
  - `callbacks`: 回调函数存储 (`Record<string, CallbackFunction>`)
  - `callbackCache`: 回调函数缓存 (`Map<CallbackFunction, string>`)
  - `messageStr`: 消息缓冲区，用于处理分片消息

#### IoInterface (`src/interface.ts`)

- **职责**: 定义统一的 IO 抽象接口
- **核心方法**:
  - `read(): Promise<string | IoMessage | null>` - 读取数据
  - `write(message: string | IoMessage): Promise<void>` - 写入数据
  - `destroy?(): void` - 清理资源
- **能力声明**:
  - `structuredClone`: 是否支持结构化克隆
  - `transfer`: 是否支持零拷贝传输

### 2. 适配器实现 (Adapter Implementations)

每个适配器都实现了 `IoInterface`，将 kkrpc 与不同的传输层协议对接：

#### String-based 适配器

- **NodeIo**: Node.js stdio 通信
- **WebSocketClientIO/ServerIO**: WebSocket 通信
- **HTTPClientIO/ServerIO**: HTTP 请求-响应模式
- **RabbitMQIO**: 基于 RabbitMQ 的消息队列通信
- **RedisStreamsIO**: 基于 Redis Streams 的流式通信

#### Structured Clone 适配器

- **WorkerParentIO/ChildIO**: Web Worker 通信，支持零拷贝传输

## 通信协议 (Communication Protocol)

### 1. 消息格式 (Message Format)

```typescript
interface Message<T = any> {
	id: string // UUID 唯一标识
	method: string // 方法名或路径
	args: T // 参数
	type: "request" | "response" | "callback" | "get" | "set" | "construct"
	callbackIds?: string[] // 回调函数 ID 列表
	version?: "json" | "superjson" // 序列化版本
	path?: string[] // 属性访问路径
	value?: any // 属性设置值
	transferSlots?: TransferSlot[] // 传输槽信息
}
```

### 2. 序列化机制 (Serialization Mechanism)

#### 双格式支持

- **JSON**: 标准序列化，向后兼容
- **SuperJSON**: 增强序列化，支持更多类型（Date, Map, Set, BigInt, Uint8Array）

#### 自动检测

```typescript
// 发送时可以选择序列化格式
const message: Message = {
	id: generateUUID(),
	method: "echo",
	args: ["hello"],
	type: "request"
}

// 接收时自动检测格式
if (message.startsWith('{"json":')) {
	const parsed = superjson.parse<Message>(message)
} else {
	const parsed = JSON.parse(message) as Message
}
```

### 3. 零拷贝传输 (Zero-Copy Transfer)

#### Transfer Slot 机制

```typescript
interface TransferSlot {
    type: "raw" | "handler"
    handlerName?: string
    metadata?: any
}

// 传输过程
1. 检测可传输对象 (ArrayBuffer, MessagePort, etc.)
2. 创建 TransferSlot 替换原始值
3. 收集 Transferable 对象
4. 在 postMessage 中传入 transfer 列表
5. 接收端根据 TransferSlot 重建对象
```

## 核心算法流程 (Core Algorithm Flow)

### 1. 远程方法调用 (Remote Method Invocation)

```typescript
// 客户端调用
await api.user.create({ name: "Alice" })

// 内部流程
1. Proxy intercept → callMethod("user.create", [{ name: "Alice" }])
2. generate UUID for request
3. Process callbacks in arguments → replace with __callback_${id}
4. Process transferable objects → create transfer slots
5. Serialize message → encodeMessage()
6. Send via IO adapter → io.write()
7. Wait for response → new Promise<>()
```

### 2. 请求处理循环 (Request Processing Loop)

```typescript
// 服务端监听循环
private async listen(): Promise<void> {
    while (true) {
        // 1. 检查适配器状态
        if ('isDestroyed' in this.io && this.io.isDestroyed) break

        // 2. 读取原始数据
        const raw = await this.io.read()
        if (raw === null) continue

        // 3. 处理消息
        await this.handleIncomingMessage(raw)
    }
}
```

### 3. 消息分发 (Message Dispatch)

```typescript
private async processDecodedMessage(message: Message): Promise<void> {
    switch (message.type) {
        case "response":
            this.handleResponse(message)      // 处理响应
            break
        case "request":
            this.handleRequest(message)       // 处理请求
            break
        case "callback":
            this.handleCallback(message)      // 处理回调
            break
        case "get":
            this.handleGet(message)           // 处理属性获取
            break
        case "set":
            this.handleSet(message)           // 处理属性设置
            break
        case "construct":
            this.handleConstruct(message)     // 处理构造函数调用
            break
    }
}
```

### 4. 方法调用执行 (Method Execution)

```typescript
private handleRequest(request: Message): void {
    // 1. 重建传输对象
    if (request.transferSlots) {
        args = reconstructValueFromTransfer(args, transferSlots, transferredValues)
    }

    // 2. 导航到目标方法
    const methodPath = request.method.split(".")
    let target = this.apiImplementation
    for (let i = 0; i < methodPath.length - 1; i++) {
        target = target[methodPath[i]]
    }

    // 3. 处理回调函数参数
    const processedArgs = args.map(arg => {
        if (typeof arg === "string" && arg.startsWith("__callback__")) {
            const callbackId = arg.slice(12)
            return (...callbackArgs) => this.invokeCallback(callbackId, callbackArgs)
        }
        return arg
    })

    // 4. 执行方法并发送响应
    try {
        const result = targetMethod.apply(target, processedArgs)
        Promise.resolve(result)
            .then(res => this.sendResponse(request.id, res))
            .catch(err => this.sendError(request.id, err))
    } catch (error) {
        this.sendError(request.id, error)
    }
}
```

## 代理系统 (Proxy System)

### 1. 嵌套代理创建 (Nested Proxy Creation)

```typescript
private createNestedProxy(chain: string[] = []): any {
    return new Proxy(() => {}, {
        get: (_target, prop) => {
            if (prop === "then" && chain.length > 0) {
                // 支持 await obj.prop
                const promise = this.getProperty(chain)
                return promise.then.bind(promise)
            }
            // 创建嵌套代理链 obj.nested.prop
            return this.createNestedProxy([...chain, prop])
        },

        set: (_target, prop, value) => {
            // 支持属性设置 obj.prop = value
            this.setProperty([...chain, prop], value)
            return true
        },

        apply: (_target, _thisArg, args) => {
            // 支持方法调用 obj.method()
            return this.callMethod(chain.join("."), args)
        },

        construct: (_target, args) => {
            // 支持构造函数调用 new obj.Constructor()
            return this.callConstructor(chain.join("."), args)
        }
    })
}
```

### 2. 属性访问处理 (Property Access Handling)

```typescript
// 获取属性
public getProperty(path: string | string[]): Promise<any> {
    return new Promise((resolve, reject) => {
        const messageId = generateUUID()
        this.pendingRequests[messageId] = { resolve, reject }

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

// 设置属性
public setProperty(path: string | string[], value: any): Promise<void> {
    // 类似 getProperty，但 type: "set" 并包含 value
}
```

## 回调机制 (Callback Mechanism)

### 1. 回调序列化 (Callback Serialization)

```typescript
// 发送端：检测并替换回调函数
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

### 2. 回调调用 (Callback Invocation)

```typescript
// 接收端：重建回调函数
const processedArgs = incomingArgs.map((arg) => {
    if (typeof arg === "string" && arg.startsWith("__callback__")) {
        const callbackId = arg.slice(12)
        return (...callbackArgs: any[]) => {
            this.invokeCallback(callbackId, callbackArgs)
        }
    }
    return arg
})

// 回调执行
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

## 错误处理 (Error Handling)

### 1. 增强错误序列化 (Enhanced Error Serialization)

```typescript
export function serializeError(error: Error): EnhancedError {
	const enhanced: EnhancedError = {
		name: error.name,
		message: error.message
	}

	// 保留所有错误属性
	if (error.stack) enhanced.stack = error.stack
	if ("cause" in error) enhanced.cause = error.cause
	for (const key in error) {
		if (!["name", "message", "stack", "cause"].includes(key)) {
			enhanced[key] = error[key]
		}
	}

	return enhanced
}

// 反序列化重建完整错误对象
export function deserializeError(enhanced: EnhancedError): Error {
	const error = new Error(enhanced.message)
	error.name = enhanced.name

	// 恢复所有属性
	for (const key in enhanced) {
		;(error as any)[key] = enhanced[key]
	}

	return error
}
```

## 适配器特定实现 (Adapter-Specific Implementations)

### 1. String-based 消息队列 (RabbitMQ)

```typescript
class RabbitMQIO implements IoInterface {
	// 使用 topic exchange 分离 kkrpc 流量
	private exchange = "kkrpc-exchange"
	private routingKey = "kkrpc.messages"

	async write(message: string): Promise<void> {
		// 发布到共享路由键，所有适配器都能接收
		await this.channel.publish(this.exchange, this.routingKey, Buffer.from(message))
	}

	private async connect(): Promise<void> {
		// 创建独占队列接收消息
		await this.channel.assertQueue(this.inboundQueue, { exclusive: true })
		await this.channel.bindQueue(this.inboundQueue, this.exchange, this.routingKey)

		// 设置消费者
		await this.channel.consume(this.inboundQueue, (msg) => {
			this.handleMessage(msg.content.toString("utf8"))
		})
	}
}
```

### 2. 流式处理 (Redis Streams)

```typescript
class RedisStreamsIO implements IoInterface {
	// 使用 XADD 发布，XREAD 消费
	async write(message: string): Promise<void> {
		await this.publisher.xadd(this.stream, "*", "data", message)
	}

	private async listenForMessages(): Promise<void> {
		while (!this.isDestroyed) {
			// 读取新消息
			const results = await this.subscriber.xread(
				"BLOCK",
				this.blockTimeout,
				"STREAMS",
				this.stream,
				"$"
			)

			if (results) {
				const [, messages] = results[0]
				for (const [, fields] of messages) {
					const messageData = fields.find(([k, v]) => k === "data")?.[1]
					if (messageData) this.handleMessage(messageData)
				}
			}
		}
	}
}
```

### 3. 零拷贝传输 (Web Workers)

```typescript
class WorkerParentIO implements IoInterface {
	capabilities = {
		structuredClone: true,
		transfer: true,
		transferTypes: ["ArrayBuffer", "MessagePort", "ImageBitmap"]
	}

	write(message: string | IoMessage): Promise<void> {
		if (message.transfers?.length > 0) {
			// 零拷贝传输
			this.worker.postMessage(message.data, message.transfers)
		} else {
			this.worker.postMessage(message.data)
		}
	}

	private normalizeIncoming(message: any): string | IoMessage {
		if (message?.version === 2) {
			// 处理传输信封
			return {
				data: message,
				transfers: message.__transferredValues || []
			}
		}
		return message
	}
}
```

## 生命周期管理 (Lifecycle Management)

### 1. 资源清理 (Resource Cleanup)

```typescript
class RPCChannel {
	destroy(): void {
		// 1. 清理回调
		this.freeCallbacks()

		// 2. 清理 IO 适配器
		if (this.io?.destroy) {
			this.io.destroy()
		}
	}

	freeCallbacks() {
		this.callbacks = {}
		this.callbackCache.clear()
	}
}
```

### 2. 销毁信号 (Destroy Signaling)

```typescript
// 统一的销毁信号
const DESTROY_SIGNAL = "__DESTROY__"

// 适配器处理销毁信号
private handleMessage(message: string): void {
    if (message === DESTROY_SIGNAL) {
        this.destroy()
        return
    }
    // 正常消息处理...
}
```

## 性能优化 (Performance Optimizations)

### 1. 消息缓冲 (Message Buffering)

```typescript
private bufferString(chunk: string): void {
    this.messageStr += chunk
    const lastChar = this.messageStr[this.messageStr.length - 1]
    const msgsSplit = this.messageStr.split("\n")
    const msgs = lastChar === "\n" ? msgsSplit : msgsSplit.slice(0, -1)
    this.messageStr = lastChar === "\n" ? "" : msgsSplit.at(-1) ?? ""

    // 处理完整消息
    for (const msgStr of msgs.filter(Boolean)) {
        if (msgStr.startsWith("{")) {
            void this.handleMessageStr(msgStr)
        }
    }
}
```

### 2. 回调缓存 (Callback Caching)

```typescript
// 缓存回调函数避免重复注册
let callbackId = this.callbackCache.get(arg)
if (!callbackId) {
	callbackId = generateUUID()
	this.callbacks[callbackId] = arg
	this.callbackCache.set(arg, callbackId)
}
```

### 3. 传输对象优化 (Transfer Object Optimization)

```typescript
// 避免重复传输同一对象
if (slotMap.has(value)) {
	const slotIndex = slotMap.get(value)!
	return `${TRANSFER_SLOT_PREFIX}${slotIndex}`
}
```

## 类型安全 (Type Safety)

### 1. 泛型约束 (Generic Constraints)

```typescript
class RPCChannel<
    LocalAPI extends Record<string, any>,    // 本地 API 类型约束
    RemoteAPI extends Record<string, any>,   // 远程 API 类型约束
    Io extends IoInterface = IoInterface     // IO 接口约束
>
```

### 2. 类型推断 (Type Inference)

```typescript
// 自动推断远程 API 类型
const api = rpc.getAPI<typeof localAPI>()
//        ^^^^^ 类型推断为 RemoteAPI
```

## 并发处理 (Concurrency Handling)

### 1. 异步消息处理 (Async Message Processing)

```typescript
// 所有消息处理都是异步的，避免阻塞
private async handleIncomingMessage(raw: string | IoMessage): Promise<void> {
    // 异步解析和处理
    const message = await decodeMessage(payload)
    await this.processDecodedMessage(message)
}
```

### 2. Promise 管理 (Promise Management)

```typescript
// 每个请求都创建独立的 Promise
public callMethod<T extends keyof RemoteAPI>(method: T, args: any[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const messageId = generateUUID()
        this.pendingRequests[messageId] = { resolve, reject }
        // ... 发送消息
    })
}
```

## 扩展性设计 (Extensibility Design)

### 1. 插件化适配器 (Pluggable Adapters)

```typescript
// 任何实现了 IoInterface 的适配器都可以接入
interface IoInterface {
	name: string
	read(): Promise<string | IoMessage | null>
	write(message: string | IoMessage): Promise<void>
	capabilities?: IoCapabilities
	destroy?(): void
}
```

### 2. 传输处理器 (Transfer Handlers)

```typescript
// 可扩展的传输处理器系统
for (const [name, handler] of transferHandlers) {
	if (handler.canHandle(value)) {
		const [serialized, handlerTransferables] = handler.serialize(value)
		// ... 处理传输
	}
}
```

## 总结 (Summary)

kkrpc 的核心算法可以概括为：

1. **统一抽象**: 通过 IoInterface 统一不同传输层的接口
2. **消息驱动**: 基于异步消息的请求-响应模式
3. **类型安全**: TypeScript 泛型确保编译时类型检查
4. **双向通信**: 双端都可以暴露和调用 API
5. **零拷贝优化**: 支持 Transferable 对象的高性能传输
6. **错误完整**: 保留完整错误对象信息
7. **生命周期**: 完善的资源管理和清理机制
8. **扩展性**: 插件化的适配器和处理器系统

这种设计使得 kkrpc 能够在 Node.js、Deno、Bun、浏览器等多种环境中无缝工作，同时保持高性能和类型安全。
