import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { KafkaIO } from "../src/adapters/kafka"
import { RPCChannel } from "../src/channel.ts"
import { apiMethods, type API } from "./scripts/api.ts"

const TEST_TOPIC = "kkrpc-test-topic-" + Math.random().toString(36).substring(2, 8)
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || "localhost:9092")
	.split(",")
	.map((broker) => broker.trim())
	.filter(Boolean)

describe("KafkaIO", () => {
	describe("Adapter Construction", () => {
		it("should create Kafka adapter with provided options", () => {
			const adapter = new KafkaIO({
				brokers: KAFKA_BROKERS,
				topic: TEST_TOPIC,
				groupId: "kkrpc-custom-group",
				clientId: "kkrpc-test-client",
				sessionId: "kafka-test-session"
			})

			expect(adapter.name).toBe("kafka-io")
			expect(adapter.getTopic()).toBe(TEST_TOPIC)
			expect(adapter.getGroupId()).toBe("kkrpc-custom-group")
			expect(adapter.getSessionId()).toBe("kafka-test-session")
			expect(adapter.capabilities.broadcast).toBe(false)

			adapter.destroy()
		})

		it("should generate reasonable defaults when not provided", () => {
			const adapter = new KafkaIO({
				brokers: KAFKA_BROKERS,
				topic: TEST_TOPIC + "-defaults"
			})

			expect(adapter.getTopic()).toBe(TEST_TOPIC + "-defaults")
			expect(adapter.getGroupId()).toMatch(/^kkrpc-group-/)
			expect(adapter.getSessionId()).toHaveLength(26)
			expect(adapter.capabilities.broadcast).toBe(true)

			adapter.destroy()
		})
	})

	describe("Connection and Topic Management", () => {
		let adapter: KafkaIO

		beforeAll(async () => {
			// allowSelfMessages keeps the low-level adapter loopback test explicit.
			adapter = new KafkaIO({
				brokers: KAFKA_BROKERS,
				topic: TEST_TOPIC + "-connection",
				clientId: "connection-test-client",
				sessionId: "connection-test-session",
				allowSelfMessages: true
			})

			// 等待 Kafka consumer 完成订阅，避免 race condition
			await new Promise((resolve) => setTimeout(resolve, 1500))
		})

		afterAll(() => {
			adapter.destroy()
		})

		it("should publish and read messages through Kafka topic", async () => {
			await adapter.write("hello-kafka")
			const payload = await adapter.read()

			expect(payload).toBe("hello-kafka")
		}, 10000)

		it("should deliver self-published messages in explicit consumer group mode", async () => {
			const groupAdapter = new KafkaIO({
				brokers: KAFKA_BROKERS,
				topic: TEST_TOPIC + "-group-self-message",
				groupId: "group-self-message-" + Math.random().toString(36).substring(2, 8),
				sessionId: "group-self-message-session"
			})

			try {
				await new Promise((resolve) => setTimeout(resolve, 2000))
				await groupAdapter.write("load-balanced-self-message")
				const payload = await Promise.race([
					groupAdapter.read(),
					new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
				])

				expect(payload).toBe("load-balanced-self-message")
			} finally {
				groupAdapter.destroy()
			}
		}, 15000)
	})

	describe("RPC Communication", () => {
		let serverAdapter: KafkaIO
		let clientAdapter: KafkaIO
		let serverRPC: RPCChannel<API, API>
		let clientRPC: RPCChannel<API, API>

		beforeAll(async () => {
			const topic = TEST_TOPIC + "-rpc"

			serverAdapter = new KafkaIO({
				brokers: KAFKA_BROKERS,
				topic,
				sessionId: "server-" + Math.random().toString(36).substring(2, 8)
			})

			clientAdapter = new KafkaIO({
				brokers: KAFKA_BROKERS,
				topic,
				sessionId: "client-" + Math.random().toString(36).substring(2, 8)
			})

			// 等 Kafka 建立连接
			await new Promise((resolve) => setTimeout(resolve, 2000))

			serverRPC = new RPCChannel<API, API>(serverAdapter, {
				expose: apiMethods
			})

			// These local handlers throw if Kafka echoes the client's own request back to itself.
			clientRPC = new RPCChannel<API, API>(clientAdapter, {
				expose: {
					...apiMethods,
					echo: async () => {
						throw new Error("client loopback should not handle echo")
					},
					add: async () => {
						throw new Error("client loopback should not handle add")
					},
					math: {
						...apiMethods.math,
						grade2: {
							...apiMethods.math.grade2,
							multiply: async () => {
								throw new Error("client loopback should not handle multiply")
							}
						}
					},
					throwSimpleError: () => {
						throw new Error("client loopback should not handle throwSimpleError")
					},
					throwCustomError: () => {
						throw new Error("client loopback should not handle throwCustomError")
					}
				}
			})
		})

		afterAll(() => {
			clientRPC.destroy?.()
			serverRPC.destroy?.()
			clientAdapter.destroy()
			serverAdapter.destroy()
		})

		it("should perform RPC round trips over Kafka", async () => {
			const serverAPI = clientRPC.getAPI()

			const echoResult = await serverAPI.echo("Hello Kafka!")
			expect(echoResult).toBe("Hello Kafka!")

			const addResult = await serverAPI.add(3, 7)
			expect(addResult).toBe(10)
		}, 20000)

		it("should support nested API calls", async () => {
			const serverAPI = clientRPC.getAPI()

			const multiply = await serverAPI.math.grade2.multiply(4, 5)
			expect(multiply).toBe(20)
		}, 20000)

		it("should propagate errors correctly", async () => {
			const serverAPI = clientRPC.getAPI()

			await expect(serverAPI.throwSimpleError()).rejects.toThrow("This is a simple error")
			await expect(serverAPI.throwCustomError()).rejects.toThrow("This is a custom error")
		}, 20000)
	})

	describe("Cleanup Handling", () => {
		it("should handle destroy and prevent further writes", async () => {
			const adapter = new KafkaIO({
				brokers: KAFKA_BROKERS,
				topic: TEST_TOPIC + "-destroy",
				sessionId: "destroy-" + Math.random().toString(36).substring(2, 8)
			})

			await new Promise((resolve) => setTimeout(resolve, 1000))

			adapter.destroy()

			await expect(adapter.write("after-destroy")).rejects.toThrow(
				"Kafka adapter has been destroyed"
			)
		}, 10000)
	})
})
