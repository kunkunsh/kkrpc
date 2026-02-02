import type { IoCapabilities, IoInterface, IoMessage } from "../interface.ts"
import type { WireEnvelope } from "../serialization.ts"

/**
 * Type definition for Electron's UtilityProcess.
 * We define our own interface to avoid requiring electron as a dependency.
 */
export interface UtilityProcess {
	postMessage(message: any, transfer?: any[]): void
	on(event: "message", listener: (message: any) => void): this
	off(event: "message", listener: (message: any) => void): this
	kill(): boolean
}

const DESTROY_SIGNAL = "__DESTROY__"

/**
 * IO adapter for Electron's utilityProcess (main process side).
 * Enables RPC communication between Electron's main process and utility processes.
 *
 * @example
 * ```typescript
 * import { utilityProcess } from 'electron'
 * import { ElectronUtilityProcessIO, RPCChannel } from 'kkrpc'
 *
 * const child = utilityProcess.fork('./utility-script.js')
 * const io = new ElectronUtilityProcessIO(child)
 * const rpc = new RPCChannel(io, { expose: apiMethods })
 * ```
 */
export class ElectronUtilityProcessIO implements IoInterface {
	name = "electron-utility-process-io"
	private messageQueue: Array<string | IoMessage> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null
	private child: UtilityProcess
	capabilities: IoCapabilities = {
		structuredClone: true,
		transfer: false
	}

	constructor(child: UtilityProcess) {
		this.child = child
		this.child.on("message", this.handleMessage)
	}

	private handleMessage = (message: any): void => {
		const normalized = this.normalizeIncoming(message)

		if (normalized === DESTROY_SIGNAL) {
			this.destroy()
			return
		}

		if (this.resolveRead) {
			this.resolveRead(normalized)
			this.resolveRead = null
		} else {
			this.messageQueue.push(normalized)
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
			this.child.postMessage(message)
			return Promise.resolve()
		}

		this.child.postMessage(message.data)
		return Promise.resolve()
	}

	destroy(): void {
		if (this.resolveRead) {
			this.resolveRead(null)
			this.resolveRead = null
		}
		this.child.postMessage(DESTROY_SIGNAL)
		this.child.off("message", this.handleMessage)
		this.child.kill()
	}

	signalDestroy(): void {
		this.child.postMessage(DESTROY_SIGNAL)
	}
}
