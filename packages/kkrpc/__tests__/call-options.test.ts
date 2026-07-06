import { describe, expect, test } from "bun:test"
import { RPCChannel, withCallOptions } from "../src/entries/mod.ts"
import type { RPCMessage, Transport } from "../src/entries/mod.ts"
import { RPCChannel as StreamingRPCChannel } from "../src/entries/streaming.ts"

// A transport that never delivers responses, so calls only settle via timeout or abort.
class SilentTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true }
	sent: RPCMessage[] = []
	send(message: RPCMessage): void {
		this.sent.push(message)
	}
	subscribe(): () => void {
		return () => {}
	}
}

interface API {
	slow(): Promise<string>
	echo(value: string): Promise<string>
}

describe("withCallOptions", () => {
	test("per-call timeout overrides the channel default", async () => {
		const transport = new SilentTransport()
		const client = new RPCChannel<object, API>(transport, { timeout: 10_000 })
		const api = client.getAPI()
		const quick = withCallOptions(api, { timeout: 30 })

		const start = Date.now()
		await expect(quick.slow()).rejects.toThrow(/timed out after 30ms/)
		expect(Date.now() - start).toBeLessThan(1000)
	})

	test("the original proxy keeps the channel default timeout", async () => {
		const transport = new SilentTransport()
		const client = new RPCChannel<object, API>(transport, { timeout: 40 })
		const api = client.getAPI()
		withCallOptions(api, { timeout: 5 }) // deriving does not mutate the original

		await expect(api.slow()).rejects.toThrow(/timed out after 40ms/)
	})

	test("an abort signal rejects an in-flight call with AbortError", async () => {
		const transport = new SilentTransport()
		const client = new RPCChannel<object, API>(transport, { timeout: 0 })
		const controller = new AbortController()
		const api = withCallOptions(client.getAPI(), { signal: controller.signal })

		const pending = api.slow()
		controller.abort()
		let caught: unknown
		try {
			await pending
		} catch (error) {
			caught = error
		}
		expect((caught as Error).name).toBe("AbortError")
	})

	test("an already-aborted signal rejects immediately without sending", async () => {
		const transport = new SilentTransport()
		const client = new RPCChannel<object, API>(transport, { timeout: 0 })
		const api = withCallOptions(client.getAPI(), { signal: AbortSignal.abort() })

		await expect(api.echo("x")).rejects.toThrow()
		expect(transport.sent).toHaveLength(0)
	})

	test("streaming proxies support withCallOptions", async () => {
		const transport = new SilentTransport()
		const client = new StreamingRPCChannel<object, API>(transport, { timeout: 10_000 })
		const quick = withCallOptions(client.getAPI(), { timeout: 30 })

		await expect(quick.slow()).rejects.toThrow(/timed out after 30ms/)
	})

	test("withCallOptions throws on a non-proxy value", () => {
		expect(() => withCallOptions({} as { x(): Promise<void> }, { timeout: 1 })).toThrow(TypeError)
	})
})
