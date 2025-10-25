import { Child, EventEmitter, type IOPayload, type OutputEvents } from "@tauri-apps/plugin-shell"
import type { IoInterface } from "../interface"

export class TauriShellStdio implements IoInterface {
	name = "tauri-shell-stdio"
	constructor(
		private readStream: EventEmitter<OutputEvents<string>>, // stdout of child process
		private childProcess: Child
	) {}

	read(): Promise<string | Uint8Array | null> {
		return new Promise((resolve, reject) => {
			this.readStream.on("data", (chunk) => {
				resolve(chunk)
			})
		})
	}
	async write(data: string, transfers?: any[]): Promise<void> {
		// Tauri shell doesn't support transferables, so we ignore them
		return this.childProcess.write(data + "\n")
	}
}
