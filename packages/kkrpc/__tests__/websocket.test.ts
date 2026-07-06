import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { WebSocketServer } from "ws"
import { RPCChannel } from "../src/entries/mod.ts"
import { RPCChannel as StreamingRPCChannel } from "../src/entries/streaming.ts"
import { webSocketClientTransport, webSocketTransport } from "../src/entries/ws.ts"
import { apiMethods, type API } from "./scripts/api.ts"

let wss: WebSocketServer
let url: string

beforeAll(() => {
	wss = new WebSocketServer({ port: 0 })
	const address = wss.address() as AddressInfo
	url = `ws://localhost:${address.port}`
	wss.on("connection", (socket) => {
		new RPCChannel<API, object>(webSocketTransport(socket), { expose: apiMethods })
	})
})

afterAll(() => {
	wss.close()
})

test("WebSocket RPC calls remote methods", async () => {
	const client = new RPCChannel<object, API>(webSocketClientTransport({ url }))
	const api = client.getAPI()

	try {
		expect(await api.add(5, 3)).toBe(8)
		expect(await api.math.grade2.multiply(4, 6)).toBe(24)
		expect(
			await Promise.all([
				api.add(10, 20),
				api.math.grade2.multiply(10, 20),
				api.add(30, 40),
				api.math.grade2.multiply(30, 40)
			])
		).toEqual([30, 200, 70, 1200])
	} finally {
		client.destroy()
	}
})

test("WebSocket supports concurrent clients", async () => {
	const clients = Array.from(
		{ length: 5 },
		() => new RPCChannel<object, API>(webSocketClientTransport({ url }))
	)

	try {
		const results = await Promise.all(
			clients.flatMap((client) => {
				const api = client.getAPI()
				return [api.add(10, 20), api.math.grade2.multiply(10, 20)]
			})
		)

		for (let index = 0; index < results.length; index += 2) {
			expect(results[index]).toBe(30)
			expect(results[index + 1]).toBe(200)
		}
	} finally {
		for (const client of clients) client.destroy()
	}
})

test("WebSocket ignores malformed frames", async () => {
	const socket = new WebSocket(url)
	await waitForOpen(socket)
	socket.send("not json")
	socket.close()

	const client = new RPCChannel<object, API>(webSocketClientTransport({ url }))
	try {
		expect(await client.getAPI().add(1, 2)).toBe(3)
	} finally {
		client.destroy()
	}
})

test("WebSocket streams async iterable results", async () => {
	type StreamAPI = {
		numbers(count: number): AsyncIterable<number>
		echo(value: string): Promise<string>
	}
	const server = new WebSocketServer({ port: 0 })
	const address = server.address() as AddressInfo
	const streamUrl = `ws://localhost:${address.port}`
	server.on("connection", (socket) => {
		new StreamingRPCChannel<StreamAPI, object>(webSocketTransport(socket), {
			expose: {
				async *numbers(count) {
					for (let index = 0; index < count; index++) yield index
				},
				async echo(value) {
					return value
				}
			}
		})
	})
	const client = new StreamingRPCChannel<object, StreamAPI>(
		webSocketClientTransport({ url: streamUrl })
	)
	const values: number[] = []

	try {
		for await (const value of client.getAPI().numbers(4)) {
			values.push(value)
		}

		expect(values).toEqual([0, 1, 2, 3])
		expect(await client.getAPI().echo("still works")).toBe("still works")
	} finally {
		client.destroy()
		server.close()
	}
})

test("WebSocket unsubscribe removes native listeners", async () => {
	const server = new WebSocketServer({ port: 0 })
	const address = server.address() as AddressInfo
	const accepted = new Promise<
		Parameters<typeof webSocketTransport>[0] & { listenerCount(event: string): number }
	>((resolve) => {
		server.once("connection", (socket) => resolve(socket))
	})
	const socket = new WebSocket(`ws://localhost:${address.port}`)
	await waitForOpen(socket)
	const serverSocket = await accepted
	const transport = webSocketTransport(serverSocket)
	const unsubscribe = transport.subscribe(() => {})

	expect(serverSocket.listenerCount("message")).toBeGreaterThan(0)
	unsubscribe()
	expect(serverSocket.listenerCount("message")).toBe(0)

	socket.close()
	server.close()
})

test("WebSocket transport rejects sends after the socket is closed", () => {
	const socket = {
		readyState: WebSocket.CLOSED,
		send() {
			throw new Error("send should not be called")
		},
		close() {}
	}
	const transport = webSocketTransport(socket)

	expect(() => transport.send({ t: "q", id: "1", op: "call", p: ["ping"] })).toThrow(
		"WebSocket is not open"
	)
})

function waitForOpen(socket: WebSocket): Promise<void> {
	return new Promise((resolve) => {
		socket.addEventListener("open", () => resolve(), { once: true })
	})
}

// --- onClose lifecycle across the three listener styles ---

test("onClose reports a reason for abnormal close (addEventListener style)", () => {
	const handlers = new Map<string, (event: unknown) => void>()
	const socket = {
		readyState: WebSocket.OPEN,
		send() {},
		close() {},
		addEventListener: (event: string, listener: (event: unknown) => void) =>
			handlers.set(event, listener),
		removeEventListener: (event: string) => handlers.delete(event)
	}
	const transport = webSocketTransport(socket)
	let reason: Error | undefined
	transport.onClose?.((r) => (reason = r))

	handlers.get("close")?.({ code: 1006, reason: "gone" })
	expect(reason).toBeInstanceOf(Error)
	expect((reason as Error).message).toContain("1006")
})

test("onClose reports undefined for a clean close code 1000", () => {
	const handlers = new Map<string, (event: unknown) => void>()
	const socket = {
		readyState: WebSocket.OPEN,
		send() {},
		close() {},
		addEventListener: (event: string, listener: (event: unknown) => void) =>
			handlers.set(event, listener),
		removeEventListener: () => {}
	}
	const transport = webSocketTransport(socket)
	let called = false
	let reason: Error | undefined = new Error("placeholder")
	transport.onClose?.((r) => {
		called = true
		reason = r
	})

	handlers.get("close")?.({ code: 1000 })
	expect(called).toBe(true)
	expect(reason).toBeUndefined()
})

test("error before close notifies once with the error (Node on/off style)", () => {
	const handlers = new Map<string, (...args: unknown[]) => void>()
	const socket = {
		readyState: WebSocket.CONNECTING,
		send() {},
		close() {},
		on: (event: string, listener: (...args: unknown[]) => void) => handlers.set(event, listener),
		off: (event: string) => handlers.delete(event)
	}
	const transport = webSocketTransport(socket)
	let count = 0
	let reason: Error | undefined
	transport.onClose?.((r) => {
		count++
		reason = r
	})

	const failure = new Error("network down")
	handlers.get("error")?.(failure)
	handlers.get("close")?.(1006, Buffer.from("late"))
	expect(count).toBe(1)
	expect(reason).toBe(failure)
})

test("onClose works via onclose/onerror slots", () => {
	const socket: {
		readyState: number
		send(): void
		close(): void
		onclose?: (event: unknown) => void
		onerror?: (event: unknown) => void
	} = {
		readyState: WebSocket.OPEN,
		send() {},
		close() {}
	}
	const transport = webSocketTransport(socket)
	let reason: Error | undefined
	transport.onClose?.((r) => (reason = r))

	socket.onclose?.({ code: 1011 })
	expect(reason).toBeInstanceOf(Error)
})

test("local close() does not fire onClose", () => {
	const handlers = new Map<string, (event: unknown) => void>()
	const socket = {
		readyState: WebSocket.OPEN,
		send() {},
		close() {},
		addEventListener: (event: string, listener: (event: unknown) => void) =>
			handlers.set(event, listener),
		removeEventListener: (event: string) => handlers.delete(event)
	}
	const transport = webSocketTransport(socket)
	let fired = false
	transport.onClose?.(() => (fired = true))

	transport.close?.()
	// A native close event after a local close must stay suppressed.
	handlers.get("close")?.({ code: 1006 })
	expect(fired).toBe(false)
})

test("client channel onClose fires when the server drops the socket", async () => {
	let resolveClosed: (reason?: Error) => void
	const closed = new Promise<Error | undefined>((resolve) => {
		resolveClosed = resolve
	})
	const client = new RPCChannel<object, API>(webSocketClientTransport({ url }), {
		onClose: (reason) => resolveClosed(reason)
	})
	const api = client.getAPI()
	expect(await api.add(1, 2)).toBe(3) // ensure the connection is established

	for (const ws of wss.clients) ws.terminate()

	await closed // resolves only if the channel observed the transport close
	await expect(api.add(1, 2)).rejects.toBeInstanceOf(Error) // fail-fast after close
	client.destroy()
})
