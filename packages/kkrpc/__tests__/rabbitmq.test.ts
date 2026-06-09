import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { RPCChannel } from "../mod.ts"
import { rabbitMqTransport, type RabbitMQTransport } from "../rabbitmq.ts"
import { createBusEnvelope } from "../src/transports/bus-envelope.ts"
import { handleRabbitMqBusEnvelope } from "../src/transports/rabbitmq.ts"
import { apiMethods, type API } from "./scripts/api.ts"

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://admin:admin@localhost:5672"
const EXCHANGE_BASE = "kkrpc-test-exchange-" + Math.random().toString(36).substring(2, 8)

describe("rabbitMqTransport", () => {
	test("nacks malformed envelopes without requeue", () => {
		const message = { content: Buffer.from("not-json") }
		const channel = {
			acked: 0,
			nacked: [] as Array<[unknown, boolean, boolean]>,
			ack() {
				this.acked++
			},
			nack(received: unknown, allUpTo: boolean, requeue: boolean) {
				this.nacked.push([received, allUpTo, requeue])
			}
		}

		handleRabbitMqBusEnvelope(message, channel, "server", new Set())

		expect(channel.acked).toBe(0)
		expect(channel.nacked).toEqual([[message, false, false]])
	})

	test("acks valid filtered envelopes", () => {
		const envelope = createBusEnvelope(
			{ t: "r", id: "request-1", v: "ok" },
			{
				transportId: "rabbitmq",
				from: "client",
				to: "server"
			}
		)
		const message = { content: Buffer.from(JSON.stringify(envelope)) }
		const channel = {
			acked: [] as unknown[],
			nacked: [] as unknown[],
			ack(received: unknown) {
				this.acked.push(received)
			},
			nack(received: unknown) {
				this.nacked.push(received)
			}
		}

		handleRabbitMqBusEnvelope(message, channel, "other", new Set())

		expect(channel.acked).toEqual([message])
		expect(channel.nacked).toEqual([])
	})

	test("nacks locally delivered envelopes when a subscriber throws", () => {
		const envelope = createBusEnvelope(
			{ t: "r", id: "request-1", v: "ok" },
			{
				transportId: "rabbitmq",
				from: "client",
				to: "server"
			}
		)
		const message = { content: Buffer.from(JSON.stringify(envelope)) }
		const channel = {
			acked: 0,
			nacked: [] as Array<[unknown, boolean, boolean]>,
			ack() {
				this.acked++
			},
			nack(received: unknown, allUpTo: boolean, requeue: boolean) {
				this.nacked.push([received, allUpTo, requeue])
			}
		}
		const listeners = new Set<() => void>([
			() => {
				throw new Error("listener failed")
			}
		])

		handleRabbitMqBusEnvelope(message, channel, "server", listeners)

		expect(channel.acked).toBe(0)
		expect(channel.nacked).toEqual([[message, false, false]])
	})

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
