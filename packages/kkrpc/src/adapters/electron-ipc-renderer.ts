import type { IoCapabilities, IoInterface, IoMessage } from "../interface.ts"
import type { WireEnvelope } from "../serialization.ts"

const DESTROY_SIGNAL = "__DESTROY__"

interface IpcRenderer {
	send(channel: string, ...args: unknown[]): void
	on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
	off(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void
}

declare global {
	interface Window {
		electron?: {
			ipcRenderer: IpcRenderer
		}
	}
}

export class ElectronIpcRendererIO implements IoInterface {
	name = "electron-ipc-renderer-io"
	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()
	private messageQueue: Array<string | IoMessage> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null
	private channel: string
	private ipcRenderer: IpcRenderer

	capabilities: IoCapabilities = {
		structuredClone: true,
		transfer: false,
		transferTypes: []
	}

	constructor(channel: string = "kkrpc-ipc") {
		if (!window.electron?.ipcRenderer) {
			throw new Error(
				"ElectronIpcRendererIO requires window.electron.ipcRenderer to be available. " +
					"Make sure to expose ipcRenderer via contextBridge in your preload script."
			)
		}

		this.channel = channel
		this.ipcRenderer = window.electron.ipcRenderer
		this.ipcRenderer.on(this.channel, this.handleMessage)
	}

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

	private handleMessage = (_event: unknown, ...args: unknown[]) => {
		const raw = args[0]
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

	private normalizeIncoming(message: unknown): string | IoMessage {
		if (typeof message === "string") {
			return message
		}

		if (message && typeof message === "object" && (message as WireEnvelope).version === 2) {
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
			this.ipcRenderer.send(this.channel, message)
			return Promise.resolve()
		}
		this.ipcRenderer.send(this.channel, message.data)
		return Promise.resolve()
	}

	destroy(): void {
		if (this.resolveRead) {
			this.resolveRead(null)
			this.resolveRead = null
		}

		this.ipcRenderer.off(this.channel, this.handleMessage)
		this.ipcRenderer.send(this.channel, DESTROY_SIGNAL)
	}

	signalDestroy(): void {
		this.ipcRenderer.send(this.channel, DESTROY_SIGNAL)
	}
}
