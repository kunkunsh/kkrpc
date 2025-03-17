import { RPCChannel, type IoInterface } from "kkrpc/browser"
import {
	Child,
	// Child,
	EventEmitter,
	hasCommand,
	likelyOnWindows,
	open as shellxOpen,
	// EventEmitter,
	// Command as ShellxCommand,
	type ChildProcess,
	type CommandEvent,
	type CommandEvents,
	type InternalSpawnOptions,
	type IOPayload,
	type OutputEvents,
	type SpawnOptions
} from "tauri-plugin-shellx-api"

export class TauriShellStdio implements IoInterface {
	name = "tauri-shell-stdio"
	constructor(
		private readStream: EventEmitter<OutputEvents<IOPayload>>, // stdout of child process
		private childProcess: Child
	) {}

	read(): Promise<string | Uint8Array | null> {
		return new Promise((resolve, reject) => {
			this.readStream.on("data", (chunk) => {
				resolve(chunk)
			})
		})
	}
	async write(data: string): Promise<void> {
		return this.childProcess.write(data + "\n")
	}
}
