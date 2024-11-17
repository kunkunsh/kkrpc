import type { DestroyableIoInterface } from "../interface.ts"

const DESTROY_SIGNAL = "__DESTROY__"

export class WorkerParentIO implements DestroyableIoInterface {
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private worker: Worker

	constructor(worker: Worker) {
		this.worker = worker
		this.worker.onmessage = this.handleMessage
	}

	private handleMessage = (event: MessageEvent) => {
		const message = event.data

		// Handle destroy signal
		if (message === DESTROY_SIGNAL) {
			this.destroy()
			return
		}

		if (this.resolveRead) {
			// If there's a pending read, resolve it immediately
			this.resolveRead(message)
			this.resolveRead = null
		} else {
			// Otherwise, queue the message
			this.messageQueue.push(message)
		}
	}

	async read(): Promise<string | null> {
		// If there are queued messages, return the first one
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		// Otherwise, wait for the next message
		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(data: string): Promise<void> {
		this.worker.postMessage(data)
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
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null

	constructor() {
		self.onmessage = this.handleMessage
	}

	private handleMessage = (event: MessageEvent) => {
		const message = event.data

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

	async read(): Promise<string | null> {
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(data: string): Promise<void> {
		self.postMessage(data)
	}

	destroy(): void {
		self.postMessage(DESTROY_SIGNAL)
		// In a worker context, we can use close() to terminate the worker
		self.close()
	}

	signalDestroy(): void {
		self.postMessage(DESTROY_SIGNAL)
	}
}
