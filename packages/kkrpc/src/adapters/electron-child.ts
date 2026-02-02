import type { IoCapabilities, IoInterface, IoMessage } from "../interface.ts"
import type { WireEnvelope } from "../serialization.ts"

/// <reference path="./electron-types.d.ts" />

const DESTROY_SIGNAL = "__DESTROY__"

export class ElectronUtilityProcessChildIO implements IoInterface {
	name = "electron-utility-process-child-io"
	private messageQueue: Array<string | IoMessage> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null
	capabilities: IoCapabilities = {
		structuredClone: true,
		transfer: false,
		transferTypes: []
	}

	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.add(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			// Silently ignore error events
		}
	}

	off(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.delete(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			// Silently ignore error events
		}
	}

	constructor() {
		if (!process.parentPort) {
			throw new Error("ElectronUtilityProcessChildIO can only be used in Electron utility process")
		}
		process.parentPort.on("message", this.handleMessage)
	}

	private handleMessage = (event: { data: any }) => {
		const raw = event.data
		const message = this.normalizeIncoming(raw)

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
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	async write(message: string | IoMessage): Promise<void> {
		if (!process.parentPort) {
			throw new Error("process.parentPort is not available")
		}

		if (typeof message === "string") {
			process.parentPort.postMessage(message)
			return
		}
		process.parentPort.postMessage(message.data)
	}

	destroy(): void {
		if (this.resolveRead) {
			this.resolveRead(null)
			this.resolveRead = null
		}

		if (process.parentPort) {
			process.parentPort.off("message", this.handleMessage)
			process.parentPort.postMessage(DESTROY_SIGNAL)
		}

		process.exit(0)
	}

	signalDestroy(): void {
		if (process.parentPort) {
			process.parentPort.postMessage(DESTROY_SIGNAL)
		}
	}
}
