/**
 * This file contains the implementation of the IframeParentIO and IframeChildIO classes.
 * They are used to create a bidirectional communication channel between a parent window and a child iframe.
 * Enhanced with Transferable objects support for performance optimization.
 */
import type { DestroyableIoInterface } from "../interface.ts"
import { isTransferableSupported, validateTransferables } from "../transferable.ts"

const DESTROY_SIGNAL = "__DESTROY__"
const PORT_INIT_SIGNAL = "__PORT_INIT__"

/**
 * This design relies on built-in `MessageChannel`, and requires a pairing process to establish the port.
 * The `PORT_INIT_SIGNAL` is designed to be initiated by the child frame, parent window will wait for the signal and establish the port.
 *
 * If `PORT_INIT_SIGNAL` is started by the parent window, there has to be a delay (with `setTimeout`) to wait for the child frame to listen to the signal.
 * Parent window can easily listen to iframe onload event, but there is no way to know when child JS is ready to listen to the message without
 * letting child `postMessage` a signal first.
 *
 * It's much easier to make sure parent window is ready (listening) before iframe is loaded, so `MessageChannel` is designed to be created from iframe's side.
 *
 * It's a good practice to call `destroy()` on either side of the channel to close `MessageChannel` and release resources.
 */
export class IframeParentIO implements DestroyableIoInterface {
	name = "iframe-parent-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private port: MessagePort | null = null

	/**
	 * @example
	 * ```ts
	 * const io = new IframeParentIO(iframeRef.contentWindow);
	 * const rpc = new RPCChannel(io, {
	 *   expose: {
	 *     add: (a: number, b: number) => Promise.resolve(a + b),
	 *   },
	 * });
	 * ```
	 */
	constructor(private targetWindow: Window) {
		this.port = null as unknown as MessagePort
		window.addEventListener("message", (event: MessageEvent) => {
			if (event.source !== this.targetWindow) return
			if (event.data === PORT_INIT_SIGNAL && event.ports.length > 0) {
				this.port = event.ports[0]
				this.port.onmessage = this.handleMessage

				while (this.messageQueue.length > 0) {
					const message = this.messageQueue.shift()
					if (message) this.port.postMessage(message)
				}
			}
		})
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

	async write(data: string, transfers?: any[]): Promise<void> {
		if (!this.port) {
			this.messageQueue.push(data)
			return
		}
		
		// Handle transferables in browser environments
		if (transfers && transfers.length > 0) {
			if (isTransferableSupported()) {
				try {
					validateTransferables(transfers)
					this.port.postMessage(data, transfers)
				} catch (error) {
					console.warn("Invalid transferables provided, sending without transfers:", error)
					this.port.postMessage(data)
				}
			} else {
				console.warn("Transferables not supported in this environment, sending without transfers")
				this.port.postMessage(data)
			}
		} else {
			this.port.postMessage(data)
		}
	}

	destroy(): void {
		if (this.port) {
			this.port.postMessage(DESTROY_SIGNAL)
			this.port.close()
		}
	}

	signalDestroy(): void {
		if (this.port) {
			this.port.postMessage(DESTROY_SIGNAL)
		}
	}
}

// Child frame version
export class IframeChildIO implements DestroyableIoInterface {
	name = "iframe-child-io"
	private messageQueue: string[] = []
	private resolveRead: ((value: string | null) => void) | null = null
	private port: MessagePort | null = null
	private pendingMessages: string[] = []
	private initialized: Promise<void>
	private channel: MessageChannel

	constructor() {
		this.channel = new MessageChannel()
		this.port = this.channel.port1
		this.port.onmessage = this.handleMessage

		window.parent.postMessage(PORT_INIT_SIGNAL, "*", [this.channel.port2])
		this.initialized = Promise.resolve()
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
		await this.initialized

		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(data: string, transfers?: any[]): Promise<void> {
		await this.initialized

		if (this.port) {
			// Handle transferables in browser environments
			if (transfers && transfers.length > 0) {
				if (isTransferableSupported()) {
					try {
						validateTransferables(transfers)
						this.port.postMessage(data, transfers)
					} catch (error) {
						console.warn("Invalid transferables provided, sending without transfers:", error)
						this.port.postMessage(data)
					}
				} else {
					console.warn("Transferables not supported in this environment, sending without transfers")
					this.port.postMessage(data)
				}
			} else {
				this.port.postMessage(data)
			}
		} else {
			this.pendingMessages.push(data)
		}
	}

	destroy(): void {
		if (this.port) {
			this.port.postMessage(DESTROY_SIGNAL)
			this.port.close()
		}
	}

	signalDestroy(): void {
		if (this.port) {
			this.port.postMessage(DESTROY_SIGNAL)
		} else {
			this.pendingMessages.push(DESTROY_SIGNAL)
		}
	}
}
