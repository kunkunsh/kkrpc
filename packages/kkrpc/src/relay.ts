import type { IoInterface } from "./interface.ts"

export interface Relay {
	destroy: () => void
}

/**
 * Creates a transparent bidirectional relay between two IoInterfaces.
 * Messages flow in both directions without parsing.
 *
 * @example
 * // Relay between IPC and stdio (Electron main process)
 * import { createRelay, NodeIo } from "kkrpc"
 * import { ElectronIpcMainIO } from "kkrpc/electron-ipc"
 * import { spawn } from "child_process"
 *
 * // Spawn external process
 * const worker = spawn("node", ["./worker.js"])
 *
 * // Create relay: IPC <-> stdio
 * const relay = createRelay(
 *   new ElectronIpcMainIO(ipcMain, webContents, "my-channel"),
 *   new NodeIo(worker.stdout, worker.stdin)
 * )
 *
 * // Cleanup
 * relay.destroy()
 *
 * @example
 * // Renderer side (separate channel)
 * import { ElectronIpcRendererIO, RPCChannel } from "kkrpc/electron-ipc"
 *
 * const io = new ElectronIpcRendererIO("my-channel")
 * const rpc = new RPCChannel(io)
 * const api = rpc.getAPI<WorkerAPI>()
 *
 * // Calls go directly to worker through main's relay
 * const result = await api.calculate(42)
 */
export function createRelay(a: IoInterface, b: IoInterface): Relay {
	const originalAOnMessage = a.onMessage
	const originalBOnMessage = b.onMessage

	a.onMessage = async (message) => {
		if (originalAOnMessage) {
			await originalAOnMessage(message)
		}
		await b.write(message as string)
	}

	b.onMessage = async (message) => {
		if (originalBOnMessage) {
			await originalBOnMessage(message)
		}
		await a.write(message as string)
	}

	return {
		destroy: () => {
			a.onMessage = originalAOnMessage
			b.onMessage = originalBOnMessage
			a.destroy?.()
			b.destroy?.()
		}
	}
}
