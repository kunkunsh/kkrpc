import type { DestroyableIoInterface } from "../interface.ts"

const DESTROY_SIGNAL = "__DESTROY__"

export class WorkerParentIO implements DestroyableIoInterface {
	name = "worker-parent-io"
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

	read(): Promise<string | null> {
		// If there are queued messages, return the first one
		if (this.messageQueue.length > 0) {
			return Promise.resolve(this.messageQueue.shift() ?? null)
		}

		// Otherwise, wait for the next message
		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	write(data: string): Promise<void> {
		this.worker.postMessage(data)
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
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null

	constructor() {
		// @ts-ignore: lack of types in deno
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
		// @ts-ignore: lack of types in deno
		self.postMessage(data)
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
