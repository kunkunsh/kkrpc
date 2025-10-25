import type { DestroyableIoInterface } from "../interface.ts"
import { isTransferableSupported, validateTransferables } from "../transferable.ts"

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

		// Check if this is a transferable message with actual transferable objects
		if (event.ports && event.ports.length > 0) {
			// Handle MessagePort transfers
			console.log('Parent: Received MessagePort transfer')
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

	write(data: string, transfers?: any[]): Promise<void> {
		// Handle transferables in browser environments
		if (transfers && transfers.length > 0) {
			if (isTransferableSupported()) {
				try {
					validateTransferables(transfers)
					// Check if we're in Bun or browser environment
					if (typeof Bun !== 'undefined') {
						// Bun doesn't support transferables in the same way as browsers
						// Send without transfers for now
						console.warn("Bun environment detected, transferables not fully supported, sending without transfers")
						this.worker.postMessage(data)
					} else {
						// Browser environment - use transferables
						this.worker.postMessage(data, transfers)
					}
				} catch (error) {
					console.warn("Invalid transferables provided, sending without transfers:", error)
					this.worker.postMessage(data)
				}
			} else {
				console.warn("Transferables not supported in this environment, sending without transfers")
				this.worker.postMessage(data)
			}
		} else {
			this.worker.postMessage(data)
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

		// Check if this is a transferable message with actual transferable objects
		if (event.ports && event.ports.length > 0) {
			// Handle MessagePort transfers
			console.log('Worker: Received MessagePort transfer')
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

	async write(data: string, transfers?: any[]): Promise<void> {
		// Handle transferables in browser environments
		if (transfers && transfers.length > 0) {
			if (isTransferableSupported()) {
				try {
					validateTransferables(transfers)
					// Check if we're in Bun or browser environment
					if (typeof Bun !== 'undefined') {
						// Bun doesn't support transferables in the same way as browsers
						// Send without transfers for now
						console.warn("Bun environment detected, transferables not fully supported, sending without transfers")
						// @ts-ignore: lack of types in deno
						self.postMessage(data)
					} else {
						// Browser environment - use transferables
						// @ts-ignore: lack of types in deno
						self.postMessage(data, transfers)
					}
				} catch (error) {
					console.warn("Invalid transferables provided, sending without transfers:", error)
					// @ts-ignore: lack of types in deno
					self.postMessage(data)
				}
			} else {
				console.warn("Transferables not supported in this environment, sending without transfers")
				// @ts-ignore: lack of types in deno
				self.postMessage(data)
			}
		} else {
			// @ts-ignore: lack of types in deno
			self.postMessage(data)
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
