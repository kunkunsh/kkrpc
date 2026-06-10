import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { RPCChannel } from "../src/entries/mod.ts"
import { redisStreamsTransport, type RedisStreamsTransport } from "../src/entries/redis-streams.ts"
import { createBusEnvelope } from "../src/transports/bus-envelope.ts"
import { processRedisStreamMessages } from "../src/transports/redis-streams.ts"
import { apiMethods, type API } from "./scripts/api.ts"

const TEST_STREAM = "kkrpc-test-stream-" + Math.random().toString(36).substring(2, 8)
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"

describe("redisStreamsTransport", () => {
	test("acks consumer group messages after successful local delivery", async () => {
		const envelope = createBusEnvelope(
			{ t: "r", id: "request-1", v: "ok" },
			{
				transportId: "redis-streams",
				from: "client",
				to: "server"
			}
		)
		const subscriber = {
			xackCalls: [] as Array<[string, string, string]>,
			async xack(stream: string, group: string, id: string) {
				this.xackCalls.push([stream, group, id])
			}
		}
		const delivered: unknown[] = []

		await processRedisStreamMessages({
			stream: "test-stream",
			consumerGroup: "test-group",
			localPeerId: "server",
			subscriber,
			messages: [["message-1", ["data", JSON.stringify(envelope)]]],
			listeners: new Set([(message) => delivered.push(message)])
		})

		expect(delivered).toEqual([envelope.message])
		expect(subscriber.xackCalls).toEqual([["test-stream", "test-group", "message-1"]])
	})

	test("does not ack consumer group messages when local delivery throws", async () => {
		const envelope = createBusEnvelope(
			{ t: "r", id: "request-1", v: "ok" },
			{
				transportId: "redis-streams",
				from: "client",
				to: "server"
			}
		)
		const subscriber = {
			xackCalls: [] as Array<[string, string, string]>,
			async xack(stream: string, group: string, id: string) {
				this.xackCalls.push([stream, group, id])
			}
		}

		await expect(
			processRedisStreamMessages({
				stream: "test-stream",
				consumerGroup: "test-group",
				localPeerId: "server",
				subscriber,
				messages: [["message-1", ["data", JSON.stringify(envelope)]]],
				listeners: new Set([
					() => {
						throw new Error("listener failed")
					}
				])
			})
		).rejects.toThrow("listener failed")
		expect(subscriber.xackCalls).toEqual([])
	})

	test("acks malformed and missing-data consumer group entries as poison", async () => {
		const subscriber = {
			xackCalls: [] as Array<[string, string, string]>,
			async xack(stream: string, group: string, id: string) {
				this.xackCalls.push([stream, group, id])
			}
		}

		await processRedisStreamMessages({
			stream: "test-stream",
			consumerGroup: "test-group",
			localPeerId: "server",
			subscriber,
			messages: [
				["missing-data", ["other", "value"]],
				["bad-json", ["data", "not-json"]]
			],
			listeners: new Set([
				() => {
					throw new Error("poison should not deliver")
				}
			])
		})

		expect(subscriber.xackCalls).toEqual([
			["test-stream", "test-group", "missing-data"],
			["test-stream", "test-group", "bad-json"]
		])
	})

	test("creates an object-mode transport with peer-routed capabilities", () => {
		const transport = redisStreamsTransport({
			url: REDIS_URL,
			stream: TEST_STREAM + "-construction",
			localPeerId: "client",
			remotePeerId: "server"
		})

		expect(transport.capabilities).toEqual({ objectMode: true, transfer: false, broadcast: false })
		transport.close?.()
	})

	describe("RPC communication", () => {
		let serverTransport: RedisStreamsTransport
		let clientTransport: RedisStreamsTransport
		let serverRPC: RPCChannel<API, API>
		let clientRPC: RPCChannel<API, API>

		beforeAll(async () => {
			serverTransport = redisStreamsTransport({
				url: REDIS_URL,
				stream: TEST_STREAM,
				localPeerId: "server",
				remotePeerId: "client"
			})
			clientTransport = redisStreamsTransport({
				url: REDIS_URL,
				stream: TEST_STREAM,
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

		test("handles basic RPC calls", async () => {
			const serverAPI = clientRPC.getAPI()

			expect(await serverAPI.echo("Hello Redis Streams!")).toBe("Hello Redis Streams!")
			expect(await serverAPI.add(10, 20)).toBe(30)
			expect(await serverAPI.subtract(50, 25)).toBe(25)
		}, 15_000)

		test("handles nested API calls", async () => {
			const serverAPI = clientRPC.getAPI()

			expect(await serverAPI.math.grade1.add(5, 3)).toBe(8)
			expect(await serverAPI.math.grade2.multiply(4, 6)).toBe(24)
			expect(await serverAPI.math.grade3.divide(20, 4)).toBe(5)
		}, 15_000)
	})
})
