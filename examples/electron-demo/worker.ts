import { ElectronUtilityProcessChildIO, RPCChannel } from "kkrpc/electron"

interface MainAPI {
	showNotification(message: string): Promise<void>
	getAppVersion(): Promise<string>
}

const io = new ElectronUtilityProcessChildIO()

let rpc: RPCChannel<typeof workerAPI, MainAPI>

const workerAPI = {
	add: async (a: number, b: number) => a + b,
	multiply: async (a: number, b: number) => a * b,
	getProcessInfo: async () => ({
		pid: process.pid,
		version: process.version,
		platform: process.platform
	}),
	pingMain: async (message: string) => {
		const mainAPI = rpc.getAPI()
		await mainAPI.showNotification(`Worker says: ${message}`)
		return `Pinged main with: ${message}`
	}
}

export type WorkerAPI = typeof workerAPI

rpc = new RPCChannel<WorkerAPI, MainAPI>(io, { expose: workerAPI })

console.error("[Worker] Process started, PID:", process.pid)
