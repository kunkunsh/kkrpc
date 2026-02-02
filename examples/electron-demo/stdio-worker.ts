import { NodeIo, RPCChannel } from "kkrpc"

interface MainAPI {
	showNotification(message: string): Promise<void>
}

const io = new NodeIo(process.stdin, process.stdout)

const stdioWorkerAPI = {
	calculateFactorial: async (n: number) => {
		if (n < 0) throw new Error("Factorial is not defined for negative numbers")
		if (n === 0 || n === 1) return 1
		let result = 1
		for (let i = 2; i <= n; i++) {
			result *= i
		}
		return result
	},

	calculateFibonacci: async (n: number) => {
		if (n < 0) throw new Error("Fibonacci index must be non-negative")
		if (n === 0) return 0
		if (n === 1) return 1
		let a = 0,
			b = 1
		for (let i = 2; i <= n; i++) {
			const temp = a + b
			a = b
			b = temp
		}
		return b
	},

	getSystemInfo: async () => ({
		pid: process.pid,
		platform: process.platform,
		arch: process.arch,
		nodeVersion: process.version
	}),

	// WARNING: executeCode is a security risk and should only be used in trusted environments
	executeCode: async (code: string) => {
		// In production, use a proper sandbox like vm2 or isolated-vm
		try {
			// eslint-disable-next-line no-eval
			return eval(code)
		} catch (error) {
			throw new Error(
				`Code execution failed: ${error instanceof Error ? error.message : String(error)}`
			)
		}
	}
}

export type StdioWorkerAPI = typeof stdioWorkerAPI

const rpc = new RPCChannel<StdioWorkerAPI, MainAPI>(io, {
	expose: stdioWorkerAPI
})

const mainAPI = rpc.getAPI()

console.error("[StdioWorker] Process started with PID:", process.pid)

// Notify main that worker is ready
mainAPI.showNotification(`Stdio worker ready (PID: ${process.pid})`).catch((error) => {
	console.error("[StdioWorker] Failed to notify main:", error)
})
