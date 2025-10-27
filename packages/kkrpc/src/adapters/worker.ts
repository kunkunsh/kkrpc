import type {
	DestroyableIoInterface,
	IoMessage,
	IoCapabilities
} from "../interface.ts"
import type { WireEnvelope } from "../serialization.ts"

const DESTROY_SIGNAL = "__DESTROY__"

export class WorkerParentIO implements DestroyableIoInterface {
	name = "worker-parent-io"
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

	private handleMessage = (event: MessageEvent) => {
		const raw = event.data
		const message = this.normalizeIncoming(raw)

		// Handle destroy signal
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

	private normalizeIncoming(message: any): string | IoMessage {
		if (typeof message === "string") {
			return message
		}

		if (message && typeof message === "object" && message.version === 2) {
			const envelope = message as WireEnvelope
			return {
				data: envelope,
				transfers: (envelope.__transferredValues as Transferable[] | undefined) ?? []
			}
		}

		return message as string
	}

	read(): Promise<string | IoMessage | null> {
		// If there are queued messages, return the first one
		if (this.messageQueue.length > 0) {
			return Promise.resolve(this.messageQueue.shift() ?? null)
		}

		// Otherwise, wait for the next message
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
			this.worker.postMessage(message.data, message.transfers)
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

// Worker version
export class WorkerChildIO implements DestroyableIoInterface {
	name = "worker-child-io"
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

	private handleMessage = (event: MessageEvent) => {
		const raw = event.data
		const message = this.normalizeIncoming(raw)

		// Handle destroy signal
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

	private normalizeIncoming(message: any): string | IoMessage {
		if (typeof message === "string") {
			return message
		}

		if (message && typeof message === "object" && message.version === 2) {
			const envelope = message as WireEnvelope
			return {
				data: envelope,
				transfers: (envelope.__transferredValues as Transferable[] | undefined) ?? []
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
			self.postMessage(message.data, message.transfers)
		} else {
			// @ts-ignore: lack of types in deno
			self.postMessage(message.data)
		}
	}

	destroy(): void {
		// @ts-ignore: lack of types in deno
		self.postMessage(DESTROY_SIGNAL)
		// In a worker context, we can use close() to terminate the worker
		self.close()
	}

	signalDestroy(): void {
		// @ts-ignore: lack of types in deno
		self.postMessage(DESTROY_SIGNAL)
	}
}
