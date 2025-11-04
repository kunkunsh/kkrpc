# Redis Streams Adapter Improvements - 2025-11-04

## 背景

根据 AI code review 的建议，对 Redis Streams adapter 进行了以下改进。

## 改进内容

### 1. Memory Management (内存管理)

**问题**: 原实现的 `messageQueue` 没有大小限制，如果消息到达速度超过消费速度，可能导致内存溢出。

**解决方案**:
- 添加 `maxQueueSize` 配置选项（默认 1000 条消息）
- 队列满时自动丢弃最老的消息，并记录警告日志
- 提示用户考虑增加 `maxQueueSize` 或加快消息处理速度

```typescript
interface RedisStreamsOptions {
	// ... 其他选项
	/**
	 * 最大队列大小，防止消息积压导致内存问题
	 * 默认 1000 条消息
	 */
	maxQueueSize?: number
}
```

**实现细节**:
```typescript
private handleMessage(message: string): void {
	// ...
	// 检查队列大小，防止内存溢出
	if (this.messageQueue.length >= this.maxQueueSize) {
		console.warn(
			`Message queue full (${this.maxQueueSize} messages), dropping oldest message. ` +
			`Consider increasing maxQueueSize or processing messages faster.`
		)
		this.messageQueue.shift() // 丢弃最老的消息
	}
	this.messageQueue.push(message)
}
```

### 2. Configuration Validation (配置验证)

**问题**: 原实现没有对配置选项进行验证，可能导致运行时错误。

**解决方案**:
- 添加 `validateOptions` 方法，在构造函数中验证所有配置
- 验证类型、范围、整数要求等
- 无效配置立即抛出异常，提供清晰的错误信息

**验证规则**:
- `blockTimeout`: 必须是非负整数
- `maxLen`: 必须是正整数
- `maxQueueSize`: 必须是正整数
- `url`, `stream`, `consumerGroup`, `consumerName`: 必须是字符串

```typescript
private validateOptions(options: RedisStreamsOptions): void {
	if (options.blockTimeout !== undefined && 
	    (options.blockTimeout < 0 || !Number.isInteger(options.blockTimeout))) {
		throw new Error("blockTimeout must be a non-negative integer")
	}

	if (options.maxLen !== undefined && 
	    (options.maxLen <= 0 || !Number.isInteger(options.maxLen))) {
		throw new Error("maxLen must be a positive integer")
	}

	if (options.maxQueueSize !== undefined && 
	    (options.maxQueueSize <= 0 || !Number.isInteger(options.maxQueueSize))) {
		throw new Error("maxQueueSize must be a positive integer")
	}

	// ... 其他验证
}
```

### 3. Performance Optimization (性能优化)

**问题**: 原实现只支持 XREAD（pub/sub 模式），在高吞吐量场景下可能不够高效。

**解决方案**:
- 添加 `useConsumerGroup` 配置选项
- 支持两种消息消费模式：
  - **Pub/Sub 模式**（默认，`useConsumerGroup: false`）: 使用 XREAD，所有 consumer 都能收到所有消息
  - **Consumer Group 模式**（`useConsumerGroup: true`）: 使用 XREADGROUP，每条消息只被一个 consumer 处理（负载均衡）

```typescript
interface RedisStreamsOptions {
	// ... 其他选项
	/**
	 * 使用 consumer group 模式 (XREADGROUP) 而非简单的 pub/sub (XREAD)
	 * - false (默认): pub/sub 模式，所有 consumer 都能收到所有消息
	 * - true: 负载均衡模式，每条消息只会被一个 consumer 处理
	 */
	useConsumerGroup?: boolean
}
```

**实现细节**:
- 在 pub/sub 模式下，使用 XREAD，不创建 consumer group
- 在 consumer group 模式下，使用 XREADGROUP，自动创建 consumer group，并在处理完消息后 ACK
- 根据模式选择不同的连接初始化和消息读取逻辑

```typescript
// Consumer Group 模式
if (this.useConsumerGroup) {
	const results = await this.subscriber.xreadgroup(
		"GROUP",
		this.consumerGroup,
		this.consumerName,
		"BLOCK",
		this.blockTimeout,
		"STREAMS",
		this.stream,
		">"
	)
	// ... 处理消息并 ACK
	await this.subscriber.xack(this.stream, this.consumerGroup, messageId)
}
// Pub/Sub 模式
else {
	const results = await this.subscriber.xread(
		"BLOCK",
		this.blockTimeout,
		"STREAMS",
		this.stream,
		this.lastId
	)
	// ... 处理消息
}
```

### 4. Enhanced Testing (增强测试)

添加了完整的测试覆盖：

1. **配置验证测试**:
   - 测试所有无效配置会抛出正确的错误
   - 测试有效配置能正常创建 adapter

2. **内存管理测试**:
   - 测试队列大小限制功能
   - 验证队列满时正确丢弃老消息

3. **Consumer Group 模式测试**:
   - 测试 XREADGROUP 模式的负载均衡行为
   - 测试 XREAD 模式的 pub/sub 行为

## 更新的文档注释

```typescript
/**
 * Redis Streams implementation of IoInterface
 * 
 * 支持两种消息消费模式:
 * 1. Pub/Sub 模式 (默认): 使用 XREAD，所有 consumer 都能收到所有消息
 * 2. Consumer Group 模式: 使用 XREADGROUP，每条消息只被一个 consumer 处理 (负载均衡)
 * 
 * 内存管理:
 * - 支持最大队列大小限制 (maxQueueSize)，防止消息积压导致内存问题
 * - 队列满时自动丢弃最老的消息并记录警告
 * 
 * 配置验证:
 * - 构造时验证所有配置选项的类型和范围
 * - 无效配置会立即抛出异常
 */
```

## 使用示例

### 基本用法（Pub/Sub 模式）
```typescript
const io = new RedisStreamsIO({
	url: "redis://localhost:6379",
	stream: "my-stream",
	maxQueueSize: 500 // 限制队列大小
})
```

### Consumer Group 模式（负载均衡）
```typescript
const io = new RedisStreamsIO({
	url: "redis://localhost:6379",
	stream: "my-stream",
	consumerGroup: "my-group",
	consumerName: "worker-1",
	useConsumerGroup: true, // 启用 consumer group 模式
	maxQueueSize: 1000
})
```

## 测试结果

所有新测试通过：
- ✅ 配置验证测试（8 个测试用例）
- ✅ 内存管理测试（队列大小限制）
- ✅ Consumer Group 模式测试（2 个场景）

## 总结

这些改进使 Redis Streams adapter 更加健壮和灵活：
1. **更安全**: 配置验证防止运行时错误，队列大小限制防止内存溢出
2. **更灵活**: 支持两种消息消费模式，适应不同的使用场景
3. **更可靠**: 完整的测试覆盖确保功能正常工作
4. **更友好**: 清晰的文档和错误提示帮助开发者正确使用

## 未来考虑

Code review 还提到的其他建议（暂未实现）：
- **Enhanced Error Scenarios**: 添加更多网络故障、Redis 不可用等错误场景的测试
- **Connection Pooling**: 实现连接池以提高资源管理效率
- **Monitoring**: 添加 metrics 和监控钩子
- **Dead Letter Queues**: 支持失败消息处理的 DLQ

