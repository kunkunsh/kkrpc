/**
 * Tests for the opt-in explicit remote-reference channel.
 *
 * These tests intentionally import from `entries/remote-refs.ts` instead of the
 * default entry so the slim core can stay free of remote-reference behavior.
 * @module
 */

import { describe, expect, test } from "bun:test"
import { registerRemoteProxy } from "../src/core/remote-ref.ts"
import { RPCChannel as CoreRPCChannel } from "../src/entries/mod.ts"
import {
	isRemoteProxy,
	isRemoteRefEnvelope,
	proxy,
	releaseProxy,
	RPCChannel,
	RPCRemoteReferenceReleasedError,
	type RPCMessage,
	type Transport,
	type TransportCapabilities
} from "../src/entries/remote-refs.ts"

class MemoryTransport implements Transport<RPCMessage> {
	capabilities: TransportCapabilities = { objectMode: true, transfer: true, remoteRefs: true }
	closed = false
	peer?: MemoryTransport
	postError?: Error
	messages: RPCMessage[] = []
	private listeners = new Set<(message: RPCMessage) => void>()

	send(message: RPCMessage): void {
		if (this.postError) throw this.postError
		this.messages.push(message)
		queueMicrotask(() => {
			for (const listener of this.peer?.listeners ?? []) listener(message)
		})
	}

	subscribe(listener: (message: RPCMessage) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	close(): void {
		this.closed = true
	}
}

function createPair(): [MemoryTransport, MemoryTransport] {
	const a = new MemoryTransport()
	const b = new MemoryTransport()
	a.peer = b
	b.peer = a
	return [a, b]
}

describe("remote references", () => {
	test("proxy marks values and releaseProxy is a no-op for non-proxies", async () => {
		const target = { value: 1 }
		expect(proxy(target)).toBe(target)
		expect(isRemoteProxy(target)).toBe(false)
		await expect(releaseProxy({ not: "remote" })).resolves.toBeUndefined()
	})

	test("releaseProxy marks remote proxies released only after release succeeds", async () => {
		const target = {}
		const releaseError = new Error("release failed")
		const record = {
			id: "ref-1",
			kind: "object" as const,
			released: false,
			async release() {
				throw releaseError
			},
			markReleased() {
				this.released = true
			}
		}
		registerRemoteProxy(target, record)

		await expect(releaseProxy(target)).rejects.toThrow(releaseError)

		expect(record.released).toBe(false)
	})

	test("isRemoteRefEnvelope identifies remote reference envelopes", () => {
		expect(isRemoteRefEnvelope({ __kkrpc_ref__: true, id: "ref-1", kind: "function" })).toBe(true)
		expect(isRemoteRefEnvelope({ __kkrpc_ref__: true, id: "ref-1", kind: "object" })).toBe(true)
		expect(isRemoteRefEnvelope({ __kkrpc_ref__: true, id: 1, kind: "function" })).toBe(false)
		expect(isRemoteRefEnvelope({ __kkrpc_ref__: true, id: "ref-1", kind: "value" })).toBe(false)
		expect(isRemoteRefEnvelope({ id: "ref-1", kind: "function" })).toBe(false)
	})

	test("normal user APIs may expose a top-level $ref property", async () => {
		const [clientTransport, serverTransport] = createPair()
		const client = new RPCChannel<object, { $ref: { ping(): Promise<string> } }>(clientTransport)
		const server = new RPCChannel<{ $ref: { ping(): string } }, object>(serverTransport, {
			expose: { $ref: { ping: () => "user-path-ok" } }
		})

		expect(await client.getAPI().$ref.ping()).toBe("user-path-ok")

		client.destroy()
		server.destroy()
	})

	test("nested proxy callback is invoked through a remote ref", async () => {
		const [clientTransport, serverTransport] = createPair()
		const client = new RPCChannel<
			object,
			{ run(input: { hooks: { onProgress(value: number): Promise<string> } }): Promise<string> }
		>(clientTransport)
		const server = new RPCChannel<
			{ run(input: { hooks: { onProgress(value: number): Promise<string> } }): Promise<string> },
			object
		>(serverTransport, {
			expose: {
				run: async (input) => await input.hooks.onProgress(7)
			}
		})

		const result = await client.getAPI().run({
			hooks: {
				onProgress: proxy(async (value: number) => `progress:${value}`)
			}
		})

		const request = clientTransport.messages[0] as Extract<RPCMessage, { t: "q" }>
		const encodedHook = ((request.a?.[0] as { hooks?: { onProgress?: unknown } }).hooks ?? {})
			.onProgress
		expect(isRemoteRefEnvelope(encodedHook)).toBe(true)
		expect(result).toBe("progress:7")

		client.destroy()
		server.destroy()
	})

	test("rejects unmarked nested functions instead of passing same-process references", async () => {
		const [clientTransport, serverTransport] = createPair()
		let called = false
		const client = new RPCChannel<object, { receive(input: { cb(): string }): Promise<string> }>(
			clientTransport
		)
		const server = new RPCChannel<{ receive(input: { cb(): string }): string }, object>(
			serverTransport,
			{
				expose: {
					receive: (input) => {
						called = true
						return input.cb()
					}
				}
			}
		)

		await expect(client.getAPI().receive({ cb: () => "plain" })).rejects.toThrow("proxy()")
		expect(clientTransport.messages).toHaveLength(0)
		expect(called).toBe(false)

		client.destroy()
		server.destroy()
	})

	test("decodes legacy top-level callback envelopes from default channels", async () => {
		const [clientTransport, serverTransport] = createPair()
		let callbackValue = ""
		const client = new CoreRPCChannel<
			object,
			{ use(callback: (value: string) => void): Promise<string> }
		>(clientTransport)
		const server = new RPCChannel<{ use(callback: (value: string) => void): string }, object>(
			serverTransport,
			{
				expose: {
					use(callback) {
						callback("from-remote-ref-server")
						return "done"
					}
				}
			}
		)

		expect(
			await client.getAPI().use((value) => {
				callbackValue = value
			})
		).toBe("done")
		expect(callbackValue).toBe("from-remote-ref-server")

		client.destroy()
		server.destroy()
	})

	test("rejects raw nested functions received from default object-mode channels", async () => {
		const [clientTransport, serverTransport] = createPair()
		let called = false
		const client = new CoreRPCChannel<
			object,
			{ receive(input: { cb(): string }): Promise<string> }
		>(clientTransport)
		const server = new RPCChannel<{ receive(input: { cb(): string }): string }, object>(
			serverTransport,
			{
				expose: {
					receive(input) {
						called = true
						return input.cb()
					}
				}
			}
		)

		await expect(client.getAPI().receive({ cb: () => "plain" })).rejects.toThrow("proxy()")
		expect(called).toBe(false)

		client.destroy()
		server.destroy()
	})

	test("explicit object proxy supports get, set, call, and release", async () => {
		const [clientTransport, serverTransport] = createPair()
		const counter = {
			value: 1,
			inc(delta: number) {
				this.value += delta
				return this.value
			}
		}
		const client = new RPCChannel<object, { getCounter(): Promise<typeof counter> }>(
			clientTransport
		)
		const server = new RPCChannel<{ getCounter(): typeof counter }, object>(serverTransport, {
			expose: { getCounter: () => proxy(counter) }
		})

		const remoteCounter = await client.getAPI().getCounter()
		expect(await remoteCounter.value).toBe(1)
		expect(await remoteCounter.inc(4)).toBe(5)
		remoteCounter.value = 10
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(counter.value).toBe(10)

		await releaseProxy(remoteCounter)
		await expect(remoteCounter.inc(1)).rejects.toThrow(RPCRemoteReferenceReleasedError)

		client.destroy()
		server.destroy()
	})

	test("rejects remote proxies decoded by a different channel", async () => {
		const [ownerTransport, firstClientTransport] = createPair()
		const handle = { ping: () => "pong" }
		const owner = new RPCChannel<{ getHandle(): typeof handle }, object>(ownerTransport, {
			expose: { getHandle: () => proxy(handle) }
		})
		const firstClient = new RPCChannel<object, { getHandle(): Promise<typeof handle> }>(
			firstClientTransport
		)
		const remoteHandle = await firstClient.getAPI().getHandle()
		const [secondClientTransport, receiverTransport] = createPair()
		const secondClient = new RPCChannel<
			object,
			{ use(handle: typeof remoteHandle): Promise<void> }
		>(secondClientTransport)
		const receiver = new RPCChannel<{ use(handle: unknown): void }, object>(receiverTransport, {
			expose: { use: () => {} }
		})

		await expect(secondClient.getAPI().use(remoteHandle)).rejects.toThrow("different RPC channel")
		expect(secondClientTransport.messages).toHaveLength(0)

		owner.destroy()
		firstClient.destroy()
		secondClient.destroy()
		receiver.destroy()
	})

	test("remote release of callback refs clears owner local ref records", async () => {
		const [clientTransport, serverTransport] = createPair()
		let serverSideCallback: ((value: number) => Promise<number>) | undefined
		const client = new RPCChannel<
			object,
			{ capture(cb: (value: number) => Promise<number>): Promise<string> }
		>(clientTransport)
		const server = new RPCChannel<
			{ capture(cb: (value: number) => Promise<number>): string },
			object
		>(serverTransport, {
			expose: {
				capture: (cb) => {
					serverSideCallback = cb
					return "captured"
				}
			}
		})

		const cb = proxy(async (value: number) => value + 1)
		expect(await client.getAPI().capture(cb)).toBe("captured")
		expect(serverSideCallback).toBeDefined()
		expect(await serverSideCallback?.(1)).toBe(2)
		await releaseProxy(serverSideCallback)

		const localRefs = client as unknown as { localRefs: Map<string, unknown> }
		expect(localRefs.localRefs.size).toBe(0)

		client.destroy()
		server.destroy()
	})

	test("remoteRefs false rejects explicit proxy refs before sending", () => {
		const [clientTransport] = createPair()
		const client = new RPCChannel<object, { use(cb: () => void): Promise<void> }>(clientTransport, {
			remoteRefs: false
		})

		expect(() => void client.getAPI().use(proxy(() => {}))).not.toThrow()
		return expect(client.getAPI().use(proxy(() => {}))).rejects.toThrow(
			"RPC channel does not support remote references"
		)
	})

	test("missing transport remoteRefs capability rejects explicit proxy refs", async () => {
		const [clientTransport] = createPair()
		clientTransport.capabilities = { objectMode: true, transfer: true }
		const client = new RPCChannel<object, { use(cb: () => void): Promise<void> }>(clientTransport)

		await expect(client.getAPI().use(proxy(() => {}))).rejects.toThrow(
			"RPC channel does not support remote references"
		)
	})

	test("rolls back retained local refs when writing a remote-ref request fails", async () => {
		const [clientTransport] = createPair()
		const client = new RPCChannel<object, { use(cb: () => void): Promise<void> }>(clientTransport)
		const localRefs = client as unknown as { localRefs: Map<string, unknown> }
		clientTransport.postError = new Error("request write failed")

		await expect(client.getAPI().use(proxy(() => {}))).rejects.toThrow("request write failed")

		expect(localRefs.localRefs.size).toBe(0)

		client.destroy()
	})

	test("rejects pending responses when remote-ref response decoding fails", async () => {
		const [clientTransport, serverTransport] = createPair()
		const client = new RPCChannel<object, { getBad(): Promise<unknown> }>(clientTransport, {
			timeout: 100
		})

		const promise = client.getAPI().getBad()
		await new Promise((resolve) => setTimeout(resolve, 0))
		const request = clientTransport.messages[0] as Extract<RPCMessage, { t: "q" }>
		serverTransport.send({ t: "r", id: request.id, v: { cb: () => "raw" } })

		const result = await Promise.race([
			promise.then(
				() => new Error("response resolved unexpectedly"),
				(error) => error
			),
			new Promise<Error>((resolve) => {
				setTimeout(() => resolve(new Error("response timed out")), 50)
			})
		])
		expect(result).toBeInstanceOf(Error)
		expect(result.message).toContain("proxy()")

		client.destroy()
	})
})
