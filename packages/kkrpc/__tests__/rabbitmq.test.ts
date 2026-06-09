import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { RPCChannel } from "../mod.ts"
import { rabbitMqTransport, type RabbitMQTransport } from "../rabbitmq.ts"
import { apiMethods, type API } from "./scripts/api.ts"

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://admin:admin@localhost:5672"
const EXCHANGE_BASE = "kkrpc-test-exchange-" + Math.random().toString(36).substring(2, 8)

describe("rabbitMqTransport", () => {
	test("creates an object-mode transport with peer-routed capabilities", () => {
		const transport = rabbitMqTransport({
			url: RABBITMQ_URL,
			exchange: EXCHANGE_BASE + "-construction",
			localPeerId: "client",
			remotePeerId: "server"
		})

		expect(transport.capabilities).toEqual({ objectMode: true, transfer: false, broadcast: false })
		transport.close?.()
	})

	describe("RPC communication", () => {
		let serverTransport: RabbitMQTransport
		let clientTransport: RabbitMQTransport
		let serverRPC: RPCChannel<API, API>
		let clientRPC: RPCChannel<API, API>

		beforeAll(async () => {
			const exchange = EXCHANGE_BASE + "-rpc"
			serverTransport = rabbitMqTransport({
				url: RABBITMQ_URL,
				exchange,
				localPeerId: "server",
				remotePeerId: "client"
			})
			clientTransport = rabbitMqTransport({
				url: RABBITMQ_URL,
				exchange,
				localPeerId: "client",
				remotePeerId: "server"
			})

			serverRPC = new RPCChannel<API, API>(serverTransport, { expose: apiMethods })
			clientRPC = new RPCChannel<API, API>(clientTransport, { expose: apiMethods })
			await new Promise((resolve) => setTimeout(resolve, 1500))
		})

		afterAll(() => {
			clientRPC.destroy()
			serverRPC.destroy()
		})

		test("completes RPC calls over RabbitMQ", async () => {
			const serverAPI = clientRPC.getAPI()

			expect(await serverAPI.echo("Hello RabbitMQ!")).toBe("Hello RabbitMQ!")
			expect(await serverAPI.add(10, 20)).toBe(30)
		}, 20_000)

		test("propagates RPC errors", async () => {
			const serverAPI = clientRPC.getAPI()

			await expect(serverAPI.throwSimpleError()).rejects.toThrow("This is a simple error")
			await expect(serverAPI.throwCustomError()).rejects.toThrow("This is a custom error")
		}, 20_000)
	})
})
