import type { IoInterface, IoMessage } from "../interface.ts"
import {
	decodeMessage,
	encodeMessage,
	type Message,
	type SerializationOptions
} from "../serialization.ts"
import type { InspectEvent, InspectorBackend, InspectorOptions } from "./types.ts"

/**
 * Wraps an IoInterface to intercept and log all messages
 */
export class InspectableIo implements IoInterface {
	public readonly name: string
	public readonly capabilities: IoInterface["capabilities"]

	private pendingRequests = new Map<string, number>()

	constructor(
		private inner: IoInterface,
		private backend: InspectorBackend,
		private sessionId: string,
		private options: InspectorOptions = {}
	) {
		this.name = `inspectable-${inner.name}`
		this.capabilities = inner.capabilities
	}

	async read(): Promise<string | IoMessage | null> {
		const msg = await this.inner.read()
		if (msg) {
			await this.logMessage(msg, "received")
		}
		return msg
	}

	async write(msg: string | IoMessage): Promise<void> {
		await this.logMessage(msg, "sent")
		return this.inner.write(msg)
	}

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(event: "message" | "error", listener: Function): void {
		this.inner.on(event as any, listener as any)
	}

	off(event: "message" | "error", listener: Function): void {
		this.inner.off(event, listener)
	}

	destroy(): void {
		this.inner.destroy?.()
		this.backend.destroy?.()
	}

	signalDestroy(): void {
		this.inner.signalDestroy?.()
	}

	private async logMessage(msg: string | IoMessage, direction: "sent" | "received"): Promise<void> {
		try {
			const decoded = await this.decode(msg)

			if (this.options.filter && !this.options.filter(decoded)) {
				return
			}

			let event: InspectEvent = {
				timestamp: Date.now(),
				direction,
				sessionId: this.sessionId,
				message: this.options.sanitize ? this.options.sanitize(decoded) : decoded,
				rawSize: typeof msg === "string" ? msg.length : undefined
			}

			if (this.options.trackLatency) {
				event = this.trackLatency(event)
			}

			this.backend.log(event)
		} catch (e) {
			// Don't let inspector errors break the RPC flow
			console.error("[kkrpc-inspector] Failed to log message:", e)
		}
	}

	private async decode(msg: string | IoMessage): Promise<Message> {
		if (typeof msg === "string") {
			return decodeMessage(msg)
		}
		return decodeMessage(msg.data)
	}

	private trackLatency(event: InspectEvent): InspectEvent {
		const { message } = event

		if (message.type === "request" && event.direction === "sent") {
			this.pendingRequests.set(message.id, event.timestamp)
		}

		if (
			(message.type === "response" || message.type === "stream-end") &&
			event.direction === "received"
		) {
			const startTime = this.pendingRequests.get(message.id)
			if (startTime) {
				event.duration = event.timestamp - startTime
				this.pendingRequests.delete(message.id)
			}
		}

		return event
	}
}
