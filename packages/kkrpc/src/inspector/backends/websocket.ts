import type { InspectEvent, InspectorBackend } from "../types.ts"

export interface WebSocketBackendOptions {
	url: string
	reconnectIntervalMs?: number
	batchSize?: number
	batchIntervalMs?: number
}

export class WebSocketBackend implements InspectorBackend {
	private ws: WebSocket | null = null
	private buffer: InspectEvent[] = []
	private batchTimer: ReturnType<typeof setInterval> | null = null
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private isDestroyed = false

	constructor(private options: WebSocketBackendOptions) {
		this.connect()
		this.startBatching()
	}

	log(event: InspectEvent): void {
		if (this.isDestroyed) return

		this.buffer.push(event)

		const batchSize = this.options.batchSize ?? 50
		if (this.buffer.length >= batchSize) {
			this.sendBatch()
		}
	}

	destroy(): void {
		this.isDestroyed = true

		if (this.batchTimer) {
			clearInterval(this.batchTimer)
			this.batchTimer = null
		}

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}

		this.sendBatch()

		if (this.ws) {
			this.ws.close()
			this.ws = null
		}
	}

	private connect(): void {
		if (this.isDestroyed || typeof WebSocket === "undefined") return

		try {
			this.ws = new WebSocket(this.options.url)

			this.ws.onopen = () => {
				console.log("[kkrpc-inspector] WebSocket connected")
				this.sendBatch()
			}

			this.ws.onclose = () => {
				if (!this.isDestroyed) {
					this.scheduleReconnect()
				}
			}

			this.ws.onerror = (error) => {
				console.error("[kkrpc-inspector] WebSocket error:", error)
			}
		} catch (e) {
			console.error("[kkrpc-inspector] Failed to connect WebSocket:", e)
			this.scheduleReconnect()
		}
	}

	private scheduleReconnect(): void {
		if (this.isDestroyed || this.reconnectTimer) return

		const interval = this.options.reconnectIntervalMs ?? 5000
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null
			this.connect()
		}, interval)
	}

	private startBatching(): void {
		const interval = this.options.batchIntervalMs ?? 500
		this.batchTimer = setInterval(() => {
			this.sendBatch()
		}, interval)
	}

	private sendBatch(): void {
		if (this.buffer.length === 0 || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
			return
		}

		const events = this.buffer
		this.buffer = []

		try {
			const payload = JSON.stringify(events)
			this.ws.send(payload)
		} catch (e) {
			console.error("[kkrpc-inspector] Failed to send events:", e)
			this.buffer.unshift(...events)
		}
	}
}
