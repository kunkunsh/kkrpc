import type { IoCapabilities, IoInterface, IoMessage } from "../interface.ts"
import type { WireEnvelope } from "../serialization.ts"

/**
 * Type definition for Electron's WebContents.
 * We define our own interface to avoid requiring electron as a dependency.
 */
export interface WebContents {
	send(channel: string, ...args: any[]): void
	isDestroyed(): boolean
}

/**
 * Type definition for Electron's IpcMainEvent.
 * We define our own interface to avoid requiring electron as a dependency.
 */
export interface IpcMainEvent {
	sender: WebContents
}

/**
 * Type definition for Electron's ipcMain module.
 * We define our own interface to avoid requiring electron as a dependency.
 */
export interface IpcMain {
	on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): this
	removeListener(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): this
}

const DESTROY_SIGNAL = "__DESTROY__"

/**
 * IO adapter for Electron's IPC from the main process side.
 * Enables RPC communication between Electron's main process and renderer processes.
 *
 * @example
 * ```typescript
 * import { ipcMain, BrowserWindow } from 'electron'
 * import { ElectronIpcMainIO, RPCChannel } from 'kkrpc'
 *
 * const win = new BrowserWindow()
 * const io = new ElectronIpcMainIO(ipcMain, win.webContents)
 * const rpc = new RPCChannel(io, { expose: apiMethods })
 * ```
 */
export class ElectronIpcMainIO implements IoInterface {
	name = "electron-ipc-main-io"
	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()
	private messageQueue: Array<string | IoMessage> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null
	private handler: ((event: IpcMainEvent, ...args: any[]) => void) | null = null
	capabilities: IoCapabilities = {
		structuredClone: true,
		transfer: false
	}

	constructor(
		private ipcMain: IpcMain,
		private webContents: WebContents,
		private channel: string = "kkrpc-ipc"
	) {
		this.handler = (event: IpcMainEvent, ...args: any[]) => {
			if (event.sender !== this.webContents) return
			if (args.length === 0) return
			this.handleMessage(args[0])
		}
		this.ipcMain.on(this.channel, this.handler)
	}

	private handleMessage = (message: any): void => {
		const normalized = this.normalizeIncoming(message)

		if (normalized === DESTROY_SIGNAL) {
			this.destroy()
			return
		}

		if (this.messageListeners.size > 0) {
			this.messageListeners.forEach((listener) => listener(normalized))
		} else {
			if (this.resolveRead) {
				this.resolveRead(normalized)
				this.resolveRead = null
			} else {
				this.messageQueue.push(normalized)
			}
		}
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
		if (this.webContents.isDestroyed()) {
			return Promise.resolve()
		}

		if (typeof message === "string") {
			this.webContents.send(this.channel, message)
			return Promise.resolve()
		}

		this.webContents.send(this.channel, message.data)
		return Promise.resolve()
	}

	destroy(): void {
		if (this.resolveRead) {
			this.resolveRead(null)
			this.resolveRead = null
		}

		if (!this.webContents.isDestroyed()) {
			this.webContents.send(this.channel, DESTROY_SIGNAL)
		}

		if (this.handler) {
			this.ipcMain.removeListener(this.channel, this.handler)
			this.handler = null
		}
	}

	signalDestroy(): void {
		if (!this.webContents.isDestroyed()) {
			this.webContents.send(this.channel, DESTROY_SIGNAL)
		}
	}
}
