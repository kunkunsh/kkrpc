import type { DestroyableIoInterface, IoCapabilities, IoMessage } from "../interface.ts"
import { RPCChannel } from "../channel.ts"

/**
 * Options for creating a Hono WebSocket handler
 */
export interface HonoWebSocketOptions<API extends Record<string, any>> {
	/** The API implementation to expose on the server */
	expose: API
	/** Optional serialization options */
	serialization?: {
		version: "json" | "superjson"
	}
}

/**
 * WebSocket IO adapter specifically for Hono that processes messages manually
 * This is needed because Hono handles messages through callbacks rather than native onmessage
 */
class HonoWebSocketIO implements DestroyableIoInterface {
	name = "hono-websocket-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	constructor(private ws: WebSocket) {}

	/**
	 * Manually feed a message from Hono's onMessage callback
	 */
	feedMessage(message: string): void {
		const DESTROY_SIGNAL = "__DESTROY__"
		
		if (message === DESTROY_SIGNAL) {
			this.destroy()
			return
		}

		if (this.resolveRead) {
			this.resolveRead(message)
			this.resolveRead = null
		} else {
			this.messageQueue.push(message)
		}
	}

	async read(): Promise<string | null> {
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(message: string | IoMessage): Promise<void> {
		if (typeof message !== "string") {
			throw new Error("HonoWebSocketIO only supports string messages")
		}
		this.ws.send(message)
	}

	destroy(): void {
		this.ws.close()
	}

	signalDestroy(): void {
		this.write("__DESTROY__")
	}
}

/**
 * Creates a Hono WebSocket handler that integrates kkrpc with Hono's upgradeWebSocket
 * 
 * This function works with Hono's upgradeWebSocket from:
 * - hono/bun
 * - hono/deno  
 * - hono/cloudflare-workers
 * 
 * @example
 * ```ts
 * // Bun example
 * import { Hono } from 'hono'
 * import { upgradeWebSocket, websocket } from 'hono/bun'
 * import { createHonoWebSocketHandler } from 'kkrpc'
 * 
 * const app = new Hono()
 * 
 * app.get('/ws', upgradeWebSocket(() => {
 *   return createHonoWebSocketHandler({
 *     expose: myAPI
 *   })
 * }))
 * 
 * Bun.serve({
 *   fetch: app.fetch,
 *   websocket
 * })
 * ```
 * 
 * @example
 * ```ts
 * // Deno example
 * import { Hono } from 'hono'
 * import { upgradeWebSocket } from 'hono/deno'
 * import { createHonoWebSocketHandler } from 'kkrpc'
 * 
 * const app = new Hono()
 * 
 * app.get('/ws', upgradeWebSocket(() => {
 *   return createHonoWebSocketHandler({
 *     expose: myAPI
 *   })
 * }))
 * 
 * Deno.serve({ fetch: app.fetch, port: 8000 })
 * ```
 */
export function createHonoWebSocketHandler<API extends Record<string, any>>(
	options: HonoWebSocketOptions<API>
): {
	onMessage(event: MessageEvent, ws: any): void
	onClose(): void
	onError?(event: Event, ws: any): void
	onOpen?(event: Event, ws: any): void
} {
	let serverIO: HonoWebSocketIO | null = null
	let rpc: RPCChannel<API, API> | null = null

	return {
		onOpen(_event: Event, ws: any) {
			// Create the IO adapter and RPC channel when connection opens
			// Hono passes different WebSocket types depending on runtime (WebSocket or WSContext)
			// Extract the actual WebSocket if it's wrapped
			const actualWs = (ws as any).raw || ws
			serverIO = new HonoWebSocketIO(actualWs)
			rpc = new RPCChannel<API, API>(serverIO, {
				expose: options.expose,
				serialization: options.serialization
			})
		},
		onMessage(event: MessageEvent, _ws: any) {
			// Convert message to string if needed
			let message = event.data
			if (typeof message === "object" && message !== null && "toString" in message) {
				message = message.toString("utf-8")
			} else if (typeof message !== "string") {
				message = String(message)
			}

			// Feed the message to the IO adapter for processing
			if (serverIO) {
				serverIO.feedMessage(message)
			}
		},
		onClose() {
			if (serverIO) {
				serverIO.destroy()
				serverIO = null
				rpc = null
			}
		},
		onError(event: Event, _ws: any) {
			console.error("Hono WebSocket error:", event)
			if (serverIO) {
				serverIO.destroy()
				serverIO = null
				rpc = null
			}
		}
	}
}
