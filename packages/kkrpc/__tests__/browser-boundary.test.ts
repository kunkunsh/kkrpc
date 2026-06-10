import { describe, expect, test } from "bun:test"
import { chromePortTransport } from "../src/entries/chrome-extension.ts"
import {
	iframeChildTransport,
	iframeChildTransportReady,
	iframeParentTransport,
	iframeParentTransportReady
} from "../src/entries/iframe.ts"
import { RPCChannel, transfer } from "../src/entries/mod.ts"
import type { RPCMessage } from "../src/core/protocol.ts"
import { webSocketClientTransport as browserWebSocketClientTransport } from "../src/transports/web-socket-client.ts"

const forbidden = [
	"node:",
	"ws",
	"hono",
	"elysia",
	"socket.io",
	"amqplib",
	"kafkajs",
	"ioredis",
	"@nats-io/transport-node",
	"@tauri-apps/plugin-shell"
]

interface TestWindow {
	parent?: TestWindow
	origin: string
	postMessage(message: unknown, targetOrigin: string, transfers?: Transferable[]): void
	addEventListener(type: "message", listener: (event: MessageEvent) => void): void
	removeEventListener(type: "message", listener: (event: MessageEvent) => void): void
}

function createWindowPair({
	parentOrigin = "https://parent.example",
	childOrigin = "https://child.example"
}: {
	parentOrigin?: string
	childOrigin?: string
} = {}) {
	const parentListeners = new Set<(event: MessageEvent) => void>()
	const childListeners = new Set<(event: MessageEvent) => void>()

	const parentWindow: TestWindow = {
		origin: parentOrigin,
		postMessage(message, _targetOrigin, transfers = []) {
			for (const listener of parentListeners) {
				listener({
					data: message,
					origin: childWindow.origin,
					ports: transfers,
					source: childWindow
				} as unknown as MessageEvent)
			}
		},
		addEventListener(_type, listener) {
			parentListeners.add(listener)
		},
		removeEventListener(_type, listener) {
			parentListeners.delete(listener)
		}
	}

	const childWindow: TestWindow = {
		origin: childOrigin,
		parent: parentWindow,
		postMessage(message, _targetOrigin, transfers = []) {
			for (const listener of childListeners) {
				listener({
					data: message,
					origin: parentWindow.origin,
					ports: transfers,
					source: parentWindow
				} as unknown as MessageEvent)
			}
		},
		addEventListener(_type, listener) {
			childListeners.add(listener)
		},
		removeEventListener(_type, listener) {
			childListeners.delete(listener)
		}
	}

	return { parentWindow, childWindow }
}

async function waitFor(condition: () => boolean): Promise<void> {
	for (let i = 0; i < 20; i++) {
		if (condition()) return
		await Bun.sleep(10)
	}
	expect(condition()).toBe(true)
}

describe("browser-safe entries", () => {
	test("main entry bundles without optional peer dependencies", async () => {
		const output = await Bun.build({
			entrypoints: [new URL("../src/entries/mod.ts", import.meta.url).pathname],
			target: "browser",
			format: "esm"
		})
		expect(output.success).toBe(true)
		const text = await output.outputs[0].text()
		for (const value of forbidden) expect(text.includes(value), value).toBe(false)
	})

	test("browser entry bundles without Node-only dependencies", async () => {
		const output = await Bun.build({
			entrypoints: [new URL("../src/entries/browser-mod.ts", import.meta.url).pathname],
			target: "browser",
			format: "esm"
		})
		expect(output.success).toBe(true)
		const text = await output.outputs[0].text()
		for (const value of forbidden) expect(text.includes(value), value).toBe(false)
	})
})

describe("iframe transports", () => {
	test("parent transfer capability is declared before MessagePort handshake", async () => {
		const { parentWindow, childWindow } = createWindowPair()
		const parentTransport = iframeParentTransport(childWindow as unknown as Window, {
			sourceWindow: parentWindow
		})

		expect(parentTransport.capabilities?.transfer).toBe(true)
		const childTransport = iframeChildTransport({ sourceWindow: childWindow })
		await waitFor(() => parentTransport.capabilities?.transfer === true)

		parentTransport.close?.()
		childTransport.close?.()
	})

	test("pre-ready iframe RPCChannel transfers ArrayBuffer after handshake", async () => {
		interface ParentAPI {
			processBuffer(buffer: ArrayBuffer): Promise<number>
		}

		const { parentWindow, childWindow } = createWindowPair()
		const parentTransport = iframeParentTransport(childWindow as unknown as Window, {
			sourceWindow: parentWindow,
			targetOrigin: childWindow.origin
		})
		const childTransport = iframeChildTransport({
			sourceWindow: childWindow,
			targetOrigin: parentWindow.origin
		})
		const parentRpc = new RPCChannel<ParentAPI, object>(parentTransport, {
			expose: { processBuffer: async (buffer) => buffer.byteLength }
		})
		const childRpc = new RPCChannel<object, ParentAPI>(childTransport)
		const api = childRpc.getAPI()
		const buffer = new ArrayBuffer(16)

		try {
			await waitFor(() => childTransport.capabilities?.transfer === true)
			expect(await api.processBuffer(transfer(buffer, [buffer]))).toBe(16)
			expect(buffer.byteLength).toBe(0)
		} finally {
			childRpc.destroy()
			parentRpc.destroy()
		}
	})

	test("child retries MessagePort init until parent transport is listening", async () => {
		const { parentWindow, childWindow } = createWindowPair()
		const childTransport = iframeChildTransport({ sourceWindow: childWindow })
		await Bun.sleep(20)

		const parentTransport = iframeParentTransport(childWindow as unknown as Window, {
			sourceWindow: parentWindow
		})
		const received: RPCMessage[] = []
		parentTransport.subscribe((message) => received.push(message))

		await waitFor(() => parentTransport.capabilities?.transfer === true)
		childTransport.send({ t: "q", id: "1", op: "call", p: ["ping"] })
		await waitFor(() => received.length === 1)

		expect(received[0]).toEqual({ t: "q", id: "1", op: "call", p: ["ping"] })
		parentTransport.close?.()
		childTransport.close?.()
	})

	test("parent rejects MessagePort init from mismatched origin before flushing queued messages", async () => {
		const { parentWindow, childWindow } = createWindowPair({ childOrigin: "https://evil.example" })
		const parentTransport = iframeParentTransport(childWindow as unknown as Window, {
			sourceWindow: parentWindow,
			targetOrigin: "https://child.example"
		})
		const childTransport = iframeChildTransport({ sourceWindow: childWindow })
		const received: RPCMessage[] = []
		childTransport.subscribe((message) => received.push(message))

		parentTransport.send({ t: "q", id: "1", op: "call", p: ["secret"] })
		await Bun.sleep(80)

		expect(received).toHaveLength(0)
		parentTransport.close?.()
		childTransport.close?.()
	})

	test("window fallback rejects messages from mismatched origin", async () => {
		const originalMessageChannel = Object.getOwnPropertyDescriptor(globalThis, "MessageChannel")
		Object.defineProperty(globalThis, "MessageChannel", {
			configurable: true,
			value: undefined
		})
		const { parentWindow, childWindow } = createWindowPair({ childOrigin: "https://evil.example" })
		const parentTransport = iframeParentTransport(childWindow as unknown as Window, {
			sourceWindow: parentWindow,
			targetOrigin: "https://child.example"
		})
		const received: RPCMessage[] = []

		try {
			parentTransport.subscribe((message) => received.push(message))
			parentWindow.postMessage({ t: "q", id: "1", op: "call", p: ["secret"] }, "*")
			await Bun.sleep(0)

			expect(received).toHaveLength(0)
		} finally {
			parentTransport.close?.()
			if (originalMessageChannel) Object.defineProperty(globalThis, "MessageChannel", originalMessageChannel)
			else Reflect.deleteProperty(globalThis, "MessageChannel")
		}
	})

	test("ready helpers resolve with window fallback transports", async () => {
		const originalMessageChannel = Object.getOwnPropertyDescriptor(globalThis, "MessageChannel")
		Object.defineProperty(globalThis, "MessageChannel", {
			configurable: true,
			value: undefined
		})
		const { parentWindow, childWindow } = createWindowPair()

		try {
			const parentTransport = await Promise.race([
				iframeParentTransportReady(childWindow as unknown as Window, { sourceWindow: parentWindow }),
				Bun.sleep(25).then(() => undefined)
			])
			const childTransport = await Promise.race([
				iframeChildTransportReady({ sourceWindow: childWindow }),
				Bun.sleep(25).then(() => undefined)
			])

			expect(parentTransport).toBeDefined()
			expect(childTransport).toBeDefined()
			parentTransport?.close?.()
			childTransport?.close?.()
		} finally {
			if (originalMessageChannel) Object.defineProperty(globalThis, "MessageChannel", originalMessageChannel)
			else Reflect.deleteProperty(globalThis, "MessageChannel")
		}
	})

	test("ready parent transport is MessagePort-backed before RPCChannel construction", async () => {
		const { parentWindow, childWindow } = createWindowPair()
		const parentTransportPromise = iframeParentTransportReady(childWindow as unknown as Window, {
			sourceWindow: parentWindow,
			targetOrigin: childWindow.origin
		})
		const childTransport = iframeChildTransport({
			sourceWindow: childWindow,
			targetOrigin: parentWindow.origin
		})

		const parentTransport = await parentTransportPromise
		expect(parentTransport.capabilities?.transfer).toBe(true)

		parentTransport.close?.()
		childTransport.close?.()
	})

	test("ready child transport is MessagePort-backed before RPCChannel construction", async () => {
		const { parentWindow, childWindow } = createWindowPair()
		const parentTransportPromise = iframeParentTransportReady(childWindow as unknown as Window, {
			sourceWindow: parentWindow,
			targetOrigin: childWindow.origin
		})
		const childTransport = await iframeChildTransportReady({
			sourceWindow: childWindow,
			targetOrigin: parentWindow.origin
		})
		const parentTransport = await parentTransportPromise

		expect(childTransport.capabilities?.transfer).toBe(true)
		parentTransport.close?.()
		childTransport.close?.()
	})

	test("ready iframe transports transfer ArrayBuffer through RPCChannel", async () => {
		interface ParentAPI {
			processBuffer(buffer: ArrayBuffer): Promise<number>
		}

		const { parentWindow, childWindow } = createWindowPair()
		const parentTransportPromise = iframeParentTransportReady(childWindow as unknown as Window, {
			sourceWindow: parentWindow,
			targetOrigin: childWindow.origin
		})
		const childTransport = await iframeChildTransportReady({
			sourceWindow: childWindow,
			targetOrigin: parentWindow.origin
		})
		const parentTransport = await parentTransportPromise
		const parentRpc = new RPCChannel<ParentAPI, object>(parentTransport, {
			expose: { processBuffer: async (buffer) => buffer.byteLength }
		})
		const childRpc = new RPCChannel<object, ParentAPI>(childTransport)
		const api = childRpc.getAPI()
		const buffer = new ArrayBuffer(16)

		try {
			expect(await api.processBuffer(transfer(buffer, [buffer]))).toBe(16)
			expect(buffer.byteLength).toBe(0)
		} finally {
			childRpc.destroy()
			parentRpc.destroy()
		}
	})
})

describe("browser WebSocket transport", () => {
	test("client transport rejects sends after the socket is closed", () => {
		const originalWebSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket")
		class ClosedWebSocket {
			static OPEN = 1
			static CLOSED = 3
			readyState = ClosedWebSocket.CLOSED
			constructor(_url: string, _protocols?: string | string[]) {}
			addEventListener() {}
			removeEventListener() {}
			send() {
				throw new Error("send should not be called")
			}
			close() {}
		}

		Object.defineProperty(globalThis, "WebSocket", {
			configurable: true,
			value: ClosedWebSocket
		})

		try {
			const transport = browserWebSocketClientTransport({ url: "ws://example.test" })
			expect(() => transport.send({ t: "q", id: "1", op: "call", p: ["ping"] })).toThrow(
				"WebSocket is not open"
			)
		} finally {
			if (originalWebSocket) Object.defineProperty(globalThis, "WebSocket", originalWebSocket)
			else Reflect.deleteProperty(globalThis, "WebSocket")
		}
	})
})

describe("chrome extension transport", () => {
	function createFakePort() {
		const messageListeners = new Set<(message: RPCMessage) => void>()
		const disconnectListeners = new Set<() => void>()
		return {
			port: {
				postMessage(_message: RPCMessage) {},
				onMessage: {
					addListener(listener: (message: RPCMessage) => void) {
						messageListeners.add(listener)
					},
					removeListener(listener: (message: RPCMessage) => void) {
						messageListeners.delete(listener)
					}
				},
				onDisconnect: {
					addListener(listener: () => void) {
						disconnectListeners.add(listener)
					},
					removeListener(listener: () => void) {
						disconnectListeners.delete(listener)
					}
				},
				disconnect() {
					for (const listener of [...disconnectListeners]) listener()
				}
			},
			messageListeners,
			disconnectListeners
		}
	}

	test("removes active listeners on close", () => {
		const fake = createFakePort()
		const transport = chromePortTransport(fake.port)
		transport.subscribe(() => {})

		expect(fake.messageListeners.size).toBe(1)
		expect(fake.disconnectListeners.size).toBe(1)
		transport.close?.()
		expect(fake.messageListeners.size).toBe(0)
		expect(fake.disconnectListeners.size).toBe(0)
	})

	test("cleans up listeners on remote disconnect", () => {
		const fake = createFakePort()
		const transport = chromePortTransport(fake.port)
		transport.subscribe(() => {})

		fake.port.disconnect()
		expect(fake.messageListeners.size).toBe(0)
		expect(fake.disconnectListeners.size).toBe(0)
	})
})
