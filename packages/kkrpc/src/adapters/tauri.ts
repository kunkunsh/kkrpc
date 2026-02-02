import { Child, EventEmitter, type OutputEvents } from "@tauri-apps/plugin-shell"
import type { IoCapabilities, IoInterface, IoMessage } from "../interface"

export class TauriShellStdio implements IoInterface {
	name = "tauri-shell-stdio"
	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
	}

	private messageListeners: Set<(message: string | IoMessage) => void> = new Set()

	on(event: "message", listener: (message: string | IoMessage) => void): void
	on(event: "error", listener: (error: Error) => void): void
	on(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.add(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			// Error events not supported by this adapter - silently ignored
		}
	}

	off(event: "message" | "error", listener: Function): void {
		if (event === "message") {
			this.messageListeners.delete(listener as (message: string | IoMessage) => void)
		} else if (event === "error") {
			// Error events not supported by this adapter - silently ignored
		}
	}

	constructor(
		private readStream: EventEmitter<OutputEvents<string>>, // stdout of child process
		private childProcess: Child
	) {}

	read(): Promise<string | IoMessage | null> {
		return new Promise((resolve, reject) => {
			this.readStream.on("data", (chunk) => {
				resolve(typeof chunk === "string" ? chunk : String(chunk))
			})
		})
	}
	async write(message: string | IoMessage): Promise<void> {
		if (typeof message !== "string") {
			throw new Error("TauriShellStdio only supports string messages")
		}
		return this.childProcess.write(message)
	}
}
