/**
 * This file contains the implementation of the IframeParentIO and IframeChildIO classes.
 * They are used to create a bidirectional communication channel between a parent window and a child iframe.
 */
import type {
	IoInterface,
	IoMessage,
	IoCapabilities
} from "../interface.ts"
import type { WireEnvelope } from "../serialization.ts"

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
export class IframeParentIO implements IoInterface {
	name = "iframe-parent-io"
	private messageQueue: Array<string | IoMessage> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null
	private port: MessagePort | null = null
 	capabilities: IoCapabilities = {
		structuredClone: true,
		transfer: true,
		transferTypes: ["ArrayBuffer", "MessagePort"]
	}

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
					if (!message) continue
					if (typeof message === "string") {
						this.port.postMessage(message)
					} else if (message.transfers && message.transfers.length > 0) {
						this.port.postMessage(message.data, message.transfers as Transferable[])
					} else {
						this.port.postMessage(message.data)
					}
				}
			}
		})
	}

	private handleMessage = (event: MessageEvent) => {
		const message = this.normalizeIncoming(event.data)

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
				transfers: (envelope.__transferredValues as unknown[] | undefined) ?? []
			}
		}

		return message as string
	}

	async read(): Promise<string | IoMessage | null> {
		// If there are queued messages, return the first one
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		// Otherwise, wait for the next message
		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(message: string | IoMessage): Promise<void> {
		if (!this.port) {
			this.messageQueue.push(message)
			return
		}
		if (typeof message === "string") {
			this.port.postMessage(message)
	} else if (message.transfers && message.transfers.length > 0) {
		this.port.postMessage(message.data, message.transfers as Transferable[])
		} else {
			this.port.postMessage(message.data)
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
export class IframeChildIO implements IoInterface {
	name = "iframe-child-io"
	private messageQueue: Array<string | IoMessage> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null
	private port: MessagePort | null = null
	private pendingMessages: Array<string | IoMessage> = []
	private initialized: Promise<void>
	private channel: MessageChannel
 	capabilities: IoCapabilities = {
		structuredClone: true,
		transfer: true,
		transferTypes: ["ArrayBuffer", "MessagePort"]
	}

	constructor() {
		this.channel = new MessageChannel()
		this.port = this.channel.port1
		this.port.onmessage = this.handleMessage

		window.parent.postMessage(PORT_INIT_SIGNAL, "*", [this.channel.port2])
		this.initialized = Promise.resolve()
	}

	private handleMessage = (event: MessageEvent) => {
		const message = this.normalizeIncoming(event.data)

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
				transfers: (envelope.__transferredValues as unknown[] | undefined) ?? []
			}
		}

		return message as string
	}

	async read(): Promise<string | IoMessage | null> {
		await this.initialized

		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(message: string | IoMessage): Promise<void> {
		await this.initialized

		if (this.port) {
			if (typeof message === "string") {
				this.port.postMessage(message)
	} else if (message.transfers && message.transfers.length > 0) {
		this.port.postMessage(message.data, message.transfers as Transferable[])
			} else {
				this.port.postMessage(message.data)
			}
		} else {
			this.pendingMessages.push(message)
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
