import { describe, expect, test } from "bun:test"
import { iframeChildTransport, iframeParentTransport } from "../iframe.ts"
import type { RPCMessage } from "../src/core/protocol.ts"

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
	postMessage(message: unknown, targetOrigin: string, transfers?: Transferable[]): void
	addEventListener(type: "message", listener: (event: MessageEvent) => void): void
	removeEventListener(type: "message", listener: (event: MessageEvent) => void): void
}

function createWindowPair() {
	const parentListeners = new Set<(event: MessageEvent) => void>()
	const childListeners = new Set<(event: MessageEvent) => void>()

	const parentWindow: TestWindow = {
		postMessage(message, _targetOrigin, transfers = []) {
			for (const listener of parentListeners) {
				listener({
					data: message,
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
		parent: parentWindow,
		postMessage(message, _targetOrigin, transfers = []) {
			for (const listener of childListeners) {
				listener({
					data: message,
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
			entrypoints: [new URL("../mod.ts", import.meta.url).pathname],
			target: "browser",
			format: "esm"
		})
		expect(output.success).toBe(true)
		const text = await output.outputs[0].text()
		for (const value of forbidden) expect(text.includes(value), value).toBe(false)
	})

	test("browser entry bundles without Node-only dependencies", async () => {
		const output = await Bun.build({
			entrypoints: [new URL("../browser-mod.ts", import.meta.url).pathname],
			target: "browser",
			format: "esm"
		})
		expect(output.success).toBe(true)
		const text = await output.outputs[0].text()
		for (const value of forbidden) expect(text.includes(value), value).toBe(false)
	})
})

describe("iframe transports", () => {
	test("parent transfer capability is enabled only after MessagePort handshake", async () => {
		const { parentWindow, childWindow } = createWindowPair()
		const parentTransport = iframeParentTransport(childWindow as unknown as Window, {
			sourceWindow: parentWindow
		})

		expect(parentTransport.capabilities?.transfer).toBe(false)
		const childTransport = iframeChildTransport({ sourceWindow: childWindow })
		await waitFor(() => parentTransport.capabilities?.transfer === true)

		parentTransport.close?.()
		childTransport.close?.()
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
})
