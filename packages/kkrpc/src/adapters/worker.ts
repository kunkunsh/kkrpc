import type { IoCapabilities, IoInterface, IoMessage } from "../interface.ts"
import type { WireEnvelope } from "../serialization.ts"

const DESTROY_SIGNAL = "__DESTROY__"

export class WorkerParentIO implements IoInterface {
	name = "worker-parent-io"
	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()
	private messageQueue: Array<string | IoMessage> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null
	private worker: Worker
	capabilities: IoCapabilities = {
		structuredClone: true,
		transfer: true,
		transferTypes: ["ArrayBuffer", "MessagePort", "ImageBitmap", "OffscreenCanvas"]
	}

	constructor(worker: Worker) {
		this.worker = worker
		this.worker.onmessage = this.handleMessage
	}

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.add(listener as (message: string | IoMessage) => void)
		}
	}

	off(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.delete(listener as (message: string | IoMessage) => void)
		}
	}

	private handleMessage = (event: MessageEvent) => {
		const raw = event.data
		const message = this.normalizeIncoming(raw)

		if (message === DESTROY_SIGNAL) {
			this.destroy()
			return
		}

		if (this.messageListeners.size > 0) {
			this.messageListeners.forEach((listener) => listener(message))
		} else if (this.resolveRead) {
			this.resolveRead(message)
			this.resolveRead = null
		} else {
			this.messageQueue.push(message)
		}
	}

	private normalizeIncoming(message: any): string | IoMessage {
		if (typeof message === "string") {
			return message
		}

		if (message && typeof message === "object" && message.version === 2) {
			const envelope = message as WireEnvelope
			return {
				data: envelope,
				transfers: (envelope.__transferredValues as unknown[] | undefined) ?? []
			}
		}

		return message as string
	}

	read(): Promise<string | IoMessage | null> {
		if (this.messageQueue.length > 0) {
			return Promise.resolve(this.messageQueue.shift() ?? null)
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	write(message: string | IoMessage): Promise<void> {
		if (typeof message === "string") {
			this.worker.postMessage(message)
			return Promise.resolve()
		}

		if (message.transfers && message.transfers.length > 0) {
			this.worker.postMessage(message.data, message.transfers as Transferable[])
		} else {
			this.worker.postMessage(message.data)
		}
		return Promise.resolve()
	}

	destroy(): void {
		this.worker.postMessage(DESTROY_SIGNAL)
		this.worker.terminate()
	}

	signalDestroy(): void {
		this.worker.postMessage(DESTROY_SIGNAL)
	}
}

export class WorkerChildIO implements IoInterface {
	name = "worker-child-io"
	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()
	private messageQueue: Array<string | IoMessage> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null
	capabilities: IoCapabilities = {
		structuredClone: true,
		transfer: true,
		transferTypes: ["ArrayBuffer", "MessagePort", "ImageBitmap", "OffscreenCanvas"]
	}

	constructor() {
		// @ts-ignore: lack of types in deno
		self.onmessage = this.handleMessage
	}

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.add(listener as (message: string | IoMessage) => void)
		}
	}

	off(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.delete(listener as (message: string | IoMessage) => void)
		}
	}

	private handleMessage = (event: MessageEvent) => {
		const raw = event.data
		const message = this.normalizeIncoming(raw)

		if (message === DESTROY_SIGNAL) {
			this.destroy()
			return
		}

		if (this.messageListeners.size > 0) {
			this.messageListeners.forEach((listener) => listener(message))
		} else if (this.resolveRead) {
			this.resolveRead(message)
			this.resolveRead = null
		} else {
			this.messageQueue.push(message)
		}
	}

	private normalizeIncoming(message: any): string | IoMessage {
		if (typeof message === "string") {
			return message
		}

		if (message && typeof message === "object" && message.version === 2) {
			const envelope = message as WireEnvelope
			return {
				data: envelope,
				transfers: (envelope.__transferredValues as unknown[] | undefined) ?? []
			}
		}

		return message as string
	}

	async read(): Promise<string | IoMessage | null> {
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(message: string | IoMessage): Promise<void> {
		if (typeof message === "string") {
			// @ts-ignore: lack of types in deno
			self.postMessage(message)
			return
		}
		if (message.transfers && message.transfers.length > 0) {
			// @ts-ignore: lack of types in deno
			self.postMessage(message.data, message.transfers as Transferable[])
		} else {
			// @ts-ignore: lack of types in deno
			self.postMessage(message.data)
		}
	}

	destroy(): void {
		if (this.resolveRead) {
			this.resolveRead(null)
			this.resolveRead = null
		}
		// @ts-ignore: lack of types in deno
		self.postMessage(DESTROY_SIGNAL)
		// @ts-ignore: lack of types in deno
		self.close()
	}

	signalDestroy(): void {
		// @ts-ignore: lack of types in deno
		self.postMessage(DESTROY_SIGNAL)
	}
}
