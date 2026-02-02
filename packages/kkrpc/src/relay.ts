import type { IoInterface, IoMessage } from "./interface.ts"

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
	let destroyed = false

	const forwardToB = (message: string | IoMessage) => {
		if (!destroyed) {
			b.write(message).catch((err) => {
				console.error(`[Relay] Failed to forward to ${b.name}:`, err)
			})
		}
	}

	const forwardToA = (message: string | IoMessage) => {
		if (!destroyed) {
			a.write(message).catch((err) => {
				console.error(`[Relay] Failed to forward to ${a.name}:`, err)
			})
		}
	}

	a.on("message", forwardToB)
	b.on("message", forwardToA)

	return {
		destroy: () => {
			destroyed = true
			a.off("message", forwardToB)
			b.off("message", forwardToA)
			a.destroy?.()
			b.destroy?.()
		}
	}
}
