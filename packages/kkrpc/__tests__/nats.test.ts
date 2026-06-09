import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { RPCChannel } from "../mod.ts"
import { natsTransport, type NatsTransport } from "../nats.ts"
import { apiMethods, type API } from "./scripts/api.ts"

const NATS_URL = process.env.NATS_URL || "nats://localhost:4222"
const TEST_SUBJECT = "kkrpc-test-" + Math.random().toString(36).substring(2, 8)

describe("natsTransport", () => {
	test("creates an object-mode transport with peer-routed capabilities", () => {
		const transport = natsTransport({
			servers: NATS_URL,
			subject: TEST_SUBJECT + "-construction",
			localPeerId: "client",
			remotePeerId: "server"
		})

		expect(transport.capabilities).toEqual({ objectMode: true, transfer: false, broadcast: false })
		transport.close?.()
	})

	describe("RPC communication", () => {
		let serverTransport: NatsTransport
		let clientTransport: NatsTransport
		let serverRPC: RPCChannel<API, API>
		let clientRPC: RPCChannel<API, API>

		beforeAll(async () => {
			const subject = TEST_SUBJECT + "-rpc"
			serverTransport = natsTransport({
				servers: NATS_URL,
				subject,
				localPeerId: "server",
				remotePeerId: "client"
			})
			clientTransport = natsTransport({
				servers: NATS_URL,
				subject,
				localPeerId: "client",
				remotePeerId: "server"
			})

			serverRPC = new RPCChannel<API, API>(serverTransport, { expose: apiMethods })
			clientRPC = new RPCChannel<API, API>(clientTransport, { expose: apiMethods })
			await new Promise((resolve) => setTimeout(resolve, 1000))
		})

		afterAll(() => {
			clientRPC.destroy()
			serverRPC.destroy()
		})

		test("completes RPC calls over NATS", async () => {
			const serverAPI = clientRPC.getAPI()

			expect(await serverAPI.echo("Hello NATS!")).toBe("Hello NATS!")
			expect(await serverAPI.add(10, 20)).toBe(30)
		}, 20_000)

		test("supports nested API calls", async () => {
			const serverAPI = clientRPC.getAPI()

			expect(await serverAPI.math.grade2.multiply(4, 5)).toBe(20)
		}, 20_000)

		test("propagates RPC errors", async () => {
			const serverAPI = clientRPC.getAPI()

			await expect(serverAPI.throwSimpleError()).rejects.toThrow("This is a simple error")
			await expect(serverAPI.throwCustomError()).rejects.toThrow("This is a custom error")
		}, 20_000)
	})
})
