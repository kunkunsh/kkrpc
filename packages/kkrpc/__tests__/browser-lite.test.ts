/**
 * Browser-lite integration tests.
 * These tests exercise the JSON-only RPCChannel wrapper without importing the
 * full SuperJSON-enabled channel facade.
 */
import { describe, expect, test } from "bun:test"
import { WebSocketServer } from "ws"
import { WebSocketClientIO, WebSocketServerIO } from "../src/adapters/websocket.ts"
import { RPCChannel } from "../src/channel-lite.ts"
import type { IoInterface } from "../src/interface.ts"

interface TestAPI {
	echo(message: string): Promise<string>
	add(a: number, b: number): Promise<number>
}

const testApi: TestAPI = {
	echo: async (message) => message,
	add: async (a, b) => a + b
}

describe("browser-lite RPCChannel", () => {
	test("calls remote methods with JSON serialization", async () => {
		const port = 3095
		const wss = new WebSocketServer({ port })
		wss.on("connection", (ws) => {
			const serverIO = new WebSocketServerIO(ws)
			new RPCChannel<TestAPI, {}>(serverIO, { expose: testApi })
		})

		const clientIO = new WebSocketClientIO({ url: `ws://localhost:${port}` })
		const rpc = new RPCChannel<{}, TestAPI, IoInterface>(clientIO)
		const api = rpc.getAPI()

		try {
			expect(await api.echo("hello")).toBe("hello")
			expect(await api.add(2, 5)).toBe(7)
		} finally {
			clientIO.destroy()
			wss.close()
		}
	})

	test("rejects explicit SuperJSON serialization option", () => {
		const io = {
			name: "closed-test-io",
			read: async () => null,
			write: async () => {},
			on: () => {},
			off: () => {}
		} satisfies IoInterface

		expect(
			() =>
				new RPCChannel<{}, TestAPI, IoInterface>(io, {
					serialization: { version: "superjson" }
				})
		).toThrow("SuperJSON serialization is not available")
	})
})
