import { describe, expect, test } from "bun:test"
import { RPCChannel } from "../src/entries/mod.ts"
import type { RPCMessage, Transport } from "../src/entries/mod.ts"
import { iframeChildTransportReady, type WindowLike } from "../src/entries/iframe.ts"
import { RPCChannel as RemoteReferenceRPCChannel } from "../src/entries/remote-refs.ts"

class MemoryTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true, transfer: true, remoteRefs: true }
	peer?: MemoryTransport
	private listeners = new Set<(message: RPCMessage) => void>()

	send(message: RPCMessage): void {
		const peer = this.peer
		queueMicrotask(() => {
			for (const listener of peer?.listeners ?? []) listener(message)
		})
	}
	subscribe(listener: (message: RPCMessage) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}
	close(): void {}
}

function createPair(): [MemoryTransport, MemoryTransport] {
	const a = new MemoryTransport()
	const b = new MemoryTransport()
	a.peer = b
	b.peer = a
	return [a, b]
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 10))

describe("onUncaughtError", () => {
	test("reports a failed set on a remote proxy", async () => {
		const [clientT, serverT] = createPair()
		const target = {} as { locked: number }
		Object.defineProperty(target, "locked", {
			get: () => 0,
			set: () => {
				throw new Error("cannot set locked")
			},
			enumerable: true
		})
		const errors: Array<{ kind: string; path?: string[] }> = []
		const client = new RPCChannel<object, { locked: number }>(clientT, {
			onUncaughtError: (_error, context) => errors.push(context)
		})
		new RPCChannel(serverT, { expose: target })

		;(client.getAPI() as { locked: number }).locked = 5
		await flush()
		expect(errors).toHaveLength(1)
		expect(errors[0].kind).toBe("set")
		expect(errors[0].path).toEqual(["locked"])
	})

	test("reports a throwing callback invocation", async () => {
		const [clientT, serverT] = createPair()
		const errors: Array<{ kind: string }> = []
		interface API {
			run(cb: () => void): Promise<void>
		}
		const client = new RPCChannel<object, API>(clientT, {
			onUncaughtError: (_error, context) => errors.push(context)
		})
		new RPCChannel(serverT, { expose: { run: (cb: () => void) => cb() } })

		await client.getAPI().run(() => {
			throw new Error("callback boom")
		})
		await flush()
		expect(errors.some((e) => e.kind === "callback")).toBe(true)
	})
})

describe("recursion depth cap", () => {
	test("remote-ref encoding rejects pathologically deep objects", async () => {
		const [clientT, serverT] = createPair()
		interface API {
			take(value: unknown): Promise<void>
		}
		const client = new RemoteReferenceRPCChannel<object, API>(clientT, {})
		new RemoteReferenceRPCChannel(serverT, { expose: { take: () => {} } })

		let deep: Record<string, unknown> = {}
		const root = deep
		for (let i = 0; i < 400; i++) {
			const next: Record<string, unknown> = {}
			deep.child = next
			deep = next
		}

		await expect(client.getAPI().take(root)).rejects.toThrow(/nesting exceeds/)
	})

	test("normal shallow objects still pass through remote-ref encoding", async () => {
		const [clientT, serverT] = createPair()
		interface API {
			echo(value: unknown): Promise<unknown>
		}
		const client = new RemoteReferenceRPCChannel<object, API>(clientT, {})
		new RemoteReferenceRPCChannel(serverT, { expose: { echo: (value: unknown) => value } })

		const value = { a: 1, nested: { b: [1, 2, { c: 3 }] } }
		expect(await client.getAPI().echo(value)).toEqual(value)
	})
})

describe("iframe handshake timeout", () => {
	test("iframeChildTransportReady rejects when the parent never acks", async () => {
		const parent: WindowLike = {
			postMessage: () => {},
			addEventListener: () => {},
			removeEventListener: () => {}
		}
		const sourceWindow: WindowLike = {
			parent,
			postMessage: () => {},
			addEventListener: () => {},
			removeEventListener: () => {}
		}

		await expect(
			iframeChildTransportReady({ sourceWindow, handshakeTimeoutMs: 40 })
		).rejects.toThrow(/handshake timed out/)
	})
})
