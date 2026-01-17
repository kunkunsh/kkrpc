import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { NatsIO } from "../src/adapters/nats"
import { RPCChannel } from "../src/channel.ts"
import { apiMethods, type API } from "./scripts/api.ts"

const NATS_URL = process.env.NATS_URL || "nats://localhost:4222"
const TEST_SUBJECT = "kkrpc-test-" + Math.random().toString(36).substring(2, 8)

describe("NatsIO", () => {
	describe("Adapter Construction", () => {
		it("should create NATS adapter with provided options", () => {
			const adapter = new NatsIO({
				servers: NATS_URL,
				subject: TEST_SUBJECT + "-construction",
				queueGroup: "test-queue-group",
				sessionId: "nats-test-session"
			})

			expect(adapter.name).toBe("nats-io")
			expect(adapter.getSubject()).toBe(TEST_SUBJECT + "-construction")
			expect(adapter.getQueueGroup()).toBe("test-queue-group")
			expect(adapter.getSessionId()).toBe("nats-test-session")

			adapter.destroy()
		})

		it("should generate reasonable defaults when not provided", async () => {
			const adapter = new NatsIO({
				servers: NATS_URL,
				subject: TEST_SUBJECT + "-defaults"
			})

			// Wait for connection to be established
			await new Promise((resolve) => setTimeout(resolve, 1000))

			expect(adapter.getSubject()).toBe(TEST_SUBJECT + "-defaults")
			expect(adapter.getQueueGroup()).toBeUndefined()
			expect(adapter.getSessionId()).toHaveLength(26)
			expect(adapter.isConnected()).toBe(true)

			adapter.destroy()
		}, 10000)
	})

	describe("Message Flow", () => {
		let adapter: NatsIO

		beforeAll(async () => {
			adapter = new NatsIO({
				servers: NATS_URL,
				subject: TEST_SUBJECT + "-message"
			})

			// Wait for connection to be ready
			await new Promise((resolve) => setTimeout(resolve, 1000))
		})

		afterAll(() => {
			adapter.destroy()
		})

		it("should publish and consume plain strings", async () => {
			await adapter.write("hello-nats")
			const payload = await adapter.read()

			expect(payload).toBe("hello-nats")
		}, 15000)
	})

	describe("RPC Communication", () => {
		let serverAdapter: NatsIO
		let clientAdapter: NatsIO
		let serverRPC: RPCChannel<API, API>
		let clientRPC: RPCChannel<API, API>

		beforeAll(async () => {
			const subject = TEST_SUBJECT + "-rpc"

			serverAdapter = new NatsIO({
				servers: NATS_URL,
				subject,
				sessionId: "server-" + Math.random().toString(36).substring(2, 8)
			})

			clientAdapter = new NatsIO({
				servers: NATS_URL,
				subject,
				sessionId: "client-" + Math.random().toString(36).substring(2, 8)
			})

			// Wait for NATS connections to be established
			await new Promise((resolve) => setTimeout(resolve, 1500))

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

		it("should complete RPC calls over NATS", async () => {
			const serverAPI = clientRPC.getAPI()

			const echoResult = await serverAPI.echo("Hello NATS!")
			expect(echoResult).toBe("Hello NATS!")

			const addResult = await serverAPI.add(10, 20)
			expect(addResult).toBe(30)
		}, 20000)

		it("should support nested API calls", async () => {
			const serverAPI = clientRPC.getAPI()

			const multiply = await serverAPI.math.grade2.multiply(4, 5)
			expect(multiply).toBe(20)
		}, 20000)

		it("should propagate RPC errors", async () => {
			const serverAPI = clientRPC.getAPI()

			await expect(serverAPI.throwSimpleError()).rejects.toThrow("This is a simple error")
			await expect(serverAPI.throwCustomError()).rejects.toThrow("This is a custom error")
		}, 20000)
	})

	describe("Queue Group (Load Balancing)", () => {
		it("should distribute messages across queue group members", async () => {
			const queueGroup = "load-test-" + Math.random().toString(36).substring(2, 8)
			const subject = TEST_SUBJECT + "-queue"

			const adapter1 = new NatsIO({
				servers: NATS_URL,
				subject,
				queueGroup
			})

			const adapter2 = new NatsIO({
				servers: NATS_URL,
				subject,
				queueGroup
			})

			// Wait for connections
			await new Promise((resolve) => setTimeout(resolve, 1000))

			// Send messages - only one should receive each
			await adapter1.write("msg1")

			const receivedBy = await Promise.race([
				adapter1.read().then(() => "adapter1" as const),
				adapter2.read().then(() => "adapter2" as const)
			])

			expect(receivedBy).toMatch(/^adapter[12]$/)

			adapter1.destroy()
			adapter2.destroy()
		}, 15000)
	})

	describe("Cleanup Handling", () => {
		it("should destroy adapter and block future writes", async () => {
			const adapter = new NatsIO({
				servers: NATS_URL,
				subject: TEST_SUBJECT + "-destroy"
			})

			await new Promise((resolve) => setTimeout(resolve, 1000))

			adapter.destroy()

			expect(adapter.isConnected()).toBe(false)

			await expect(adapter.write("after-destroy")).rejects.toThrow(
				"NATS adapter has been destroyed"
			)
		}, 10000)
	})
})
