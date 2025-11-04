import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { RabbitMQIO } from "../src/adapters/rabbitmq"
import { RPCChannel } from "../src/channel.ts"
import { apiMethods, type API } from "./scripts/api.ts"

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://admin:admin@localhost:5672"
const EXCHANGE_BASE = "kkrpc-test-exchange-" + Math.random().toString(36).substring(2, 8)

describe("RabbitMQIO", () => {
	describe("Adapter Construction", () => {
		it("should create RabbitMQ adapter with provided options", () => {
			const adapter = new RabbitMQIO({
				url: RABBITMQ_URL,
				exchange: EXCHANGE_BASE + "-construction",
				sessionId: "rabbitmq-test-session",
				exchangeType: "topic",
				durable: true
			})

			expect(adapter.name).toBe("rabbitmq-io")
			expect(adapter.getExchange()).toBe(EXCHANGE_BASE + "-construction")
			expect(adapter.getSessionId()).toBe("rabbitmq-test-session")

			adapter.destroy()
		})
	})

	describe("Message Flow", () => {
		let adapter: RabbitMQIO

		beforeAll(async () => {
			adapter = new RabbitMQIO({
				url: RABBITMQ_URL,
				exchange: EXCHANGE_BASE + "-message"
			})

			// 等待连接 ready，避免消费队列还没创建就写入
			await new Promise(resolve => setTimeout(resolve, 1500))
		})

		afterAll(() => {
			adapter.destroy()
		})

		it("should publish and consume plain strings", async () => {
			await adapter.write("hello-rabbitmq")
			const payload = await adapter.read()

			expect(payload).toBe("hello-rabbitmq")
		}, 15000)
	})

	describe("RPC Communication", () => {
		let serverAdapter: RabbitMQIO
		let clientAdapter: RabbitMQIO
		let serverRPC: RPCChannel<API, API>
		let clientRPC: RPCChannel<API, API>

		beforeAll(async () => {
			const exchange = EXCHANGE_BASE + "-rpc"

			serverAdapter = new RabbitMQIO({
				url: RABBITMQ_URL,
				exchange,
				sessionId: "server-" + Math.random().toString(36).substring(2, 8)
			})

			clientAdapter = new RabbitMQIO({
				url: RABBITMQ_URL,
				exchange,
				sessionId: "client-" + Math.random().toString(36).substring(2, 8)
			})

			// RabbitMQ 需要一点时间建队列，先休眠
			await new Promise(resolve => setTimeout(resolve, 2000))

			serverRPC = new RPCChannel<API, API>(serverAdapter, {
				expose: apiMethods
			})

			clientRPC = new RPCChannel<API, API>(clientAdapter, {
				expose: apiMethods
			})
		})

		afterAll(async () => {
			await Promise.all([clientAdapter.signalDestroy?.(), serverAdapter.signalDestroy?.()])
			clientRPC.destroy?.()
			serverRPC.destroy?.()
			clientAdapter.destroy()
			serverAdapter.destroy()
		})

		it("should complete RPC calls over RabbitMQ", async () => {
			const serverAPI = clientRPC.getAPI()

			const echoResult = await serverAPI.echo("Hello RabbitMQ!")
			expect(echoResult).toBe("Hello RabbitMQ!")

			const addResult = await serverAPI.add(10, 20)
			expect(addResult).toBe(30)
		}, 20000)

		it("should propagate RPC errors", async () => {
			const serverAPI = clientRPC.getAPI()

			await expect(serverAPI.throwSimpleError()).rejects.toThrow("This is a simple error")
			await expect(serverAPI.throwCustomError()).rejects.toThrow("This is a custom error")
		}, 20000)
	})

	describe("Cleanup Handling", () => {
		it("should destroy adapter and block future writes", async () => {
			const adapter = new RabbitMQIO({
				url: RABBITMQ_URL,
				exchange: EXCHANGE_BASE + "-destroy"
			})

			await new Promise(resolve => setTimeout(resolve, 1000))

			adapter.destroy()

			await expect(adapter.write("after-destroy")).rejects.toThrow("RabbitMQ adapter has been destroyed")
		}, 10000)
	})
})
