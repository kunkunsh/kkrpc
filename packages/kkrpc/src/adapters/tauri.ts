import { Child, EventEmitter, type OutputEvents } from "@tauri-apps/plugin-shell"
import type { IoCapabilities, IoInterface, IoMessage } from "../interface"

export class TauriShellStdio implements IoInterface {
	name = "tauri-shell-stdio"
	capabilities: IoCapabilities = {
		structuredClone: false,
		transfer: false
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
