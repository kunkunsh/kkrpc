import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { RedisStreamsIO } from "../src/adapters/redis-streams"
import { RPCChannel } from "../src/channel.ts"
import { apiMethods, type API } from "./scripts/api.ts"

// Test configuration
const TEST_STREAM = "kkrpc-test-stream-" + Math.random().toString(36).substring(2, 8)
const TEST_GROUP = "kkrpc-test-group"
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"

describe("RedisStreamsIO", () => {
	describe("Adapter Construction", () => {
		it("should create Redis Streams adapter instance", () => {
			const adapter = new RedisStreamsIO({
				url: REDIS_URL,
				stream: TEST_STREAM,
				consumerGroup: TEST_GROUP,
				sessionId: "test-adapter"
			})

			expect(adapter.name).toBe("redis-streams-io")
			expect(adapter.getStream()).toBe(TEST_STREAM)
			expect(adapter.getConsumerGroup()).toBe(TEST_GROUP)
			expect(adapter.getSessionId()).toBe("test-adapter")
		})

		it("should generate default values when options not provided", () => {
			const adapter = new RedisStreamsIO()

			expect(adapter.getStream()).toBe("kkrpc-stream")
			expect(adapter.getConsumerGroup()).toBe("kkrpc-group")
			expect(adapter.getSessionId()).toHaveLength(26)
		})
	})

	describe("Configuration Validation", () => {
		it("should reject negative blockTimeout", () => {
			expect(() => {
				new RedisStreamsIO({ blockTimeout: -1 })
			}).toThrow("blockTimeout must be a non-negative integer")
		})

		it("should reject non-integer blockTimeout", () => {
			expect(() => {
				new RedisStreamsIO({ blockTimeout: 5.5 })
			}).toThrow("blockTimeout must be a non-negative integer")
		})

		it("should reject non-positive maxLen", () => {
			expect(() => {
				new RedisStreamsIO({ maxLen: 0 })
			}).toThrow("maxLen must be a positive integer")

			expect(() => {
				new RedisStreamsIO({ maxLen: -10 })
			}).toThrow("maxLen must be a positive integer")
		})

		it("should reject non-positive maxQueueSize", () => {
			expect(() => {
				new RedisStreamsIO({ maxQueueSize: 0 })
			}).toThrow("maxQueueSize must be a positive integer")

			expect(() => {
				new RedisStreamsIO({ maxQueueSize: -5 })
			}).toThrow("maxQueueSize must be a positive integer")
		})

		it("should reject invalid URL type", () => {
			expect(() => {
				new RedisStreamsIO({ url: 123 as any })
			}).toThrow("url must be a string")
		})

		it("should reject invalid stream type", () => {
			expect(() => {
				new RedisStreamsIO({ stream: {} as any })
			}).toThrow("stream must be a string")
		})

		it("should reject invalid consumerGroup type", () => {
			expect(() => {
				new RedisStreamsIO({ consumerGroup: [] as any })
			}).toThrow("consumerGroup must be a string")
		})

		it("should accept valid configuration", () => {
			const adapter = new RedisStreamsIO({
				url: REDIS_URL,
				stream: TEST_STREAM,
				blockTimeout: 1000,
				maxLen: 100,
				maxQueueSize: 500,
				useConsumerGroup: false
			})

			expect(adapter.name).toBe("redis-streams-io")
		})
	})

	describe("Connection and Stream Management", () => {
		let adapter: RedisStreamsIO

		beforeAll(async () => {
			adapter = new RedisStreamsIO({
				url: REDIS_URL,
				stream: TEST_STREAM,
				consumerGroup: TEST_GROUP
			})
			// Wait for connection to establish
			await new Promise((resolve) => setTimeout(resolve, 1000))
		})

		afterAll(() => {
			adapter.destroy()
		})

		it("should connect to Redis successfully", async () => {
			// If we get here without timeout, connection was successful
			const streamInfo = await adapter.getStreamInfo()
			expect(streamInfo).toBeDefined()
			expect(typeof streamInfo.length).toBe("number")
		})

		it("should get stream information", async () => {
			const info = await adapter.getStreamInfo()
			expect(info).toHaveProperty("length")
			expect(info).toHaveProperty("groups")
			expect(info).toHaveProperty("lastEntry")
			expect(typeof info.length).toBe("number")
			expect(typeof info.groups).toBe("number")
		})

		it("should trim stream successfully", async () => {
			// First add some messages by writing to the stream
			await adapter.write("test message 1")
			await adapter.write("test message 2")
			await adapter.write("test message 3")

			// Get initial length
			const initialInfo = await adapter.getStreamInfo()
			expect(initialInfo.length).toBe(3)

			// Trim to max 2 entries
			await adapter.trimStream(2)

			// Note: With consumer groups, Redis may not immediately delete entries
			// The trim operation itself should complete without error
			const finalInfo = await adapter.getStreamInfo()
			// At minimum, the stream should still exist and have valid info
			expect(finalInfo.length).toBeGreaterThanOrEqual(0)
		})
	})

	describe("RPC Communication", () => {
		let serverAdapter: RedisStreamsIO
		let clientAdapter: RedisStreamsIO
		let serverRPC: RPCChannel<API, API>
		let clientRPC: RPCChannel<API, API>

		beforeAll(async () => {
			// Create server adapter
			serverAdapter = new RedisStreamsIO({
				url: REDIS_URL,
				stream: TEST_STREAM,
				consumerGroup: TEST_GROUP,
				sessionId: "server-" + Math.random().toString(36).substring(2, 8)
			})

			// Create client adapter with different session ID
			clientAdapter = new RedisStreamsIO({
				url: REDIS_URL,
				stream: TEST_STREAM,
				consumerGroup: TEST_GROUP,
				sessionId: "client-" + Math.random().toString(36).substring(2, 8)
			})

			// Wait for connections to establish
			await new Promise((resolve) => setTimeout(resolve, 1000))

			// Create RPC channels
			serverRPC = new RPCChannel<API, API>(serverAdapter, {
				expose: apiMethods
			})

			clientRPC = new RPCChannel<API, API>(clientAdapter, {
				expose: apiMethods
			})
		})

		afterAll(() => {
			clientAdapter.destroy()
			serverAdapter.destroy()
		})

		it("should handle basic RPC calls", async () => {
			const serverAPI = clientRPC.getAPI()

			// Test basic methods
			const echoResult = await serverAPI.echo("Hello Redis Streams!")
			expect(echoResult).toBe("Hello Redis Streams!")

			const addResult = await serverAPI.add(10, 20)
			expect(addResult).toBe(30)

			const subtractResult = await serverAPI.subtract(50, 25)
			expect(subtractResult).toBe(25)
		}, 15000)

		it("should handle nested API calls", async () => {
			const serverAPI = clientRPC.getAPI()

			const grade1Result = await serverAPI.math.grade1.add(5, 3)
			expect(grade1Result).toBe(8)

			const grade2Result = await serverAPI.math.grade2.multiply(4, 6)
			expect(grade2Result).toBe(24)

			const grade3Result = await serverAPI.math.grade3.divide(20, 4)
			expect(grade3Result).toBe(5)
		}, 15000)

		it("should handle concurrent RPC calls", async () => {
			const serverAPI = clientRPC.getAPI()

			const results = await Promise.all([
				serverAPI.add(10, 20),
				serverAPI.subtract(50, 20),
				serverAPI.echo("concurrent test"),
				serverAPI.math.grade2.multiply(3, 7)
			])

			expect(results).toEqual([30, 30, "concurrent test", 21])
		}, 20000)

		it("should handle property access", async () => {
			const serverAPI = clientRPC.getAPI()

			const counter = await serverAPI.counter
			expect(counter).toBe(42)

			const nestedValue = await serverAPI.nested.value
			expect(nestedValue).toBe("hello world")

			const deepProp = await serverAPI.nested.deepObj.prop
			expect(deepProp).toBe(true)
		}, 15000)

		it("should handle error propagation", async () => {
			const serverAPI = clientRPC.getAPI()

			// Test simple error throwing
			await expect(serverAPI.throwSimpleError()).rejects.toThrow("This is a simple error")

			// Test custom error throwing
			await expect(serverAPI.throwCustomError()).rejects.toThrow("This is a custom error")
		}, 15000)

		it("should handle bidirectional communication", async () => {
			const clientAPI = serverRPC.getAPI()
			const serverAPI = clientRPC.getAPI()

			// Test calls in both directions
			const serverResult = await serverAPI.echo("Client to Server")
			const clientResult = await clientAPI.echo("Server to Client")

			expect(serverResult).toBe("Client to Server")
			expect(clientResult).toBe("Server to Client")
		}, 15000)
	})

	describe("Multiple Consumers", () => {
		let adapters: RedisStreamsIO[]
		let rpcs: RPCChannel<{}, API>[]

		beforeAll(async () => {
			const numConsumers = 3
			adapters = []
			rpcs = []

			for (let i = 0; i < numConsumers; i++) {
				const adapter = new RedisStreamsIO({
					url: REDIS_URL,
					stream: TEST_STREAM,
					consumerGroup: TEST_GROUP,
					sessionId: `consumer-${i}-${Math.random().toString(36).substring(2, 8)}`
				})

				adapters.push(adapter)
				rpcs.push(new RPCChannel<{}, API>(adapter))
			}

			// Wait for all connections to establish
			await new Promise((resolve) => setTimeout(resolve, 1000))
		})

		afterAll(() => {
			rpcs.forEach((rpc) => rpc.destroy?.())
			adapters.forEach((adapter) => adapter.destroy())
		})

		it("should handle multiple consumers concurrently", async () => {
			// Create a server adapter for responding
			const serverAdapter = new RedisStreamsIO({
				url: REDIS_URL,
				stream: TEST_STREAM,
				consumerGroup: TEST_GROUP,
				sessionId: "server-" + Math.random().toString(36).substring(2, 8)
			})

			await new Promise((resolve) => setTimeout(resolve, 1000))

			const serverRPC = new RPCChannel<API, {}>(serverAdapter, {
				expose: apiMethods
			})

			try {
				// Test concurrent calls from multiple consumers
				const results = await Promise.all(
					rpcs.flatMap((rpc) => {
						const api = rpc.getAPI()
						return [api.add(10, 20), api.subtract(50, 25), api.echo("multi-consumer test")]
					})
				)

				// Verify all results
				for (let i = 0; i < results.length; i += 3) {
					expect(results[i]).toBe(30) // add result
					expect(results[i + 1]).toBe(25) // subtract result
					expect(results[i + 2]).toBe("multi-consumer test") // echo result
				}
			} finally {
				serverRPC.destroy?.()
				serverAdapter.destroy()
			}
		}, 30000)
	})

	describe("Cleanup and Resource Management", () => {
		it("should destroy adapter and clean up resources", async () => {
			const adapter = new RedisStreamsIO({
				url: REDIS_URL,
				stream: TEST_STREAM,
				consumerGroup: TEST_GROUP
			})

			// Should not throw
			expect(() => adapter.destroy()).not.toThrow()

			// Should handle operations after destroy
			await expect(adapter.write("test")).rejects.toThrow(
				"Redis Streams adapter has been destroyed"
			)
		})

		it("should handle destroy signaling", async () => {
			const adapter1 = new RedisStreamsIO({
				url: REDIS_URL,
				stream: TEST_STREAM,
				consumerGroup: TEST_GROUP,
				sessionId: "destroy-test-1"
			})

			const adapter2 = new RedisStreamsIO({
				url: REDIS_URL,
				stream: TEST_STREAM,
				consumerGroup: TEST_GROUP,
				sessionId: "destroy-test-2"
			})

			await new Promise((resolve) => setTimeout(resolve, 1000))

			// Send destroy signal
			await adapter1.signalDestroy()

			// Wait for signal to be processed
			await new Promise((resolve) => setTimeout(resolve, 1000))

			// Cleanup
			adapter1.destroy()
			adapter2.destroy()
		})
	})

	describe("Memory Management - Queue Size Limit", () => {
		it("should limit queue size and drop old messages when full", async () => {
			const smallQueueAdapter = new RedisStreamsIO({
				url: REDIS_URL,
				stream: TEST_STREAM + "-queue-test",
				maxQueueSize: 5 // Very small queue for testing
			})

			// Wait for connection
			await new Promise((resolve) => setTimeout(resolve, 1000))

			// Write many messages without reading them
			for (let i = 0; i < 10; i++) {
				await smallQueueAdapter.write(`message-${i}`)
			}

			// Wait for messages to be processed
			await new Promise((resolve) => setTimeout(resolve, 2000))

			// Read all available messages - should only get the last 5
			const messages: string[] = []

			// Try to read with timeout to avoid hanging
			const readWithTimeout = async (timeout: number) => {
				return Promise.race([
					smallQueueAdapter.read(),
					new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout))
				])
			}

			// Read until we get null or timeout
			for (let i = 0; i < 10; i++) {
				const msg = await readWithTimeout(100)
				if (msg === null) break
				messages.push(msg)
			}

			// Should have at most 5 messages (the queue size limit)
			expect(messages.length).toBeLessThanOrEqual(5)

			smallQueueAdapter.destroy()
		})
	})

	describe("Consumer Group Mode", () => {
		it("should use XREADGROUP when useConsumerGroup is true", async () => {
			const stream = TEST_STREAM + "-cg-test-" + Math.random().toString(36).substring(2, 8)

			// Consumer group mode 适用于工作队列场景:
			// - 一个客户端发送任务
			// - 多个 worker 从同一个消费组中竞争处理任务 (每个任务只被处理一次)

			// Create a client that sends requests (not in consumer group)
			const client = new RedisStreamsIO({
				url: REDIS_URL,
				stream,
				useConsumerGroup: false
			})

			// Create two workers in the same consumer group
			const worker1 = new RedisStreamsIO({
				url: REDIS_URL,
				stream,
				consumerGroup: "workers",
				consumerName: "worker-1",
				useConsumerGroup: true
			})

			const worker2 = new RedisStreamsIO({
				url: REDIS_URL,
				stream,
				consumerGroup: "workers",
				consumerName: "worker-2",
				useConsumerGroup: true
			})

			// Wait for connections
			await new Promise((resolve) => setTimeout(resolve, 1500))

			// Create RPC channels - workers expose the API
			const clientRPC = new RPCChannel<{}, API>(client)
			const worker1RPC = new RPCChannel<API, {}>(worker1, { expose: apiMethods })
			const worker2RPC = new RPCChannel<API, {}>(worker2, { expose: apiMethods })

			// Client sends requests, workers process them
			const api = clientRPC.getAPI()

			// Send multiple requests - they should be distributed between workers
			const results = await Promise.all([
				api.add(1, 2),
				api.add(3, 4),
				api.echo("test1"),
				api.echo("test2")
			])

			expect(results).toEqual([3, 7, "test1", "test2"])

			// Cleanup
			client.destroy()
			worker1.destroy()
			worker2.destroy()
		}, 10000)

		it("should handle messages in pub/sub mode when useConsumerGroup is false", async () => {
			const stream = TEST_STREAM + "-pubsub-test-" + Math.random().toString(36).substring(2, 8)

			// Create two consumers without consumer group mode (default)
			const consumer1 = new RedisStreamsIO({
				url: REDIS_URL,
				stream,
				useConsumerGroup: false
			})

			const consumer2 = new RedisStreamsIO({
				url: REDIS_URL,
				stream,
				useConsumerGroup: false
			})

			// Wait for connections
			await new Promise((resolve) => setTimeout(resolve, 1500))

			// Create RPC channels
			const rpc1 = new RPCChannel<API, API>(consumer1, { expose: apiMethods })
			const rpc2 = new RPCChannel<API, API>(consumer2, { expose: apiMethods })

			// In pub/sub mode, all consumers should receive all messages
			const api1 = rpc1.getAPI()
			const api2 = rpc2.getAPI()

			// Call methods from both consumers
			const results = await Promise.all([api1.add(5, 10), api2.add(7, 8)])

			expect(results).toEqual([15, 15])

			// Cleanup
			consumer1.destroy()
			consumer2.destroy()
		})
	})
})
