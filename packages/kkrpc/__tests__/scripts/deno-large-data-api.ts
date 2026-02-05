import { DenoIo, RPCChannel } from "../../mod.ts"

const largeDataAPI = {
	uploadData: async (data: string) => ({
		bytesReceived: data.length,
		chunks: 1
	}),
	downloadData: async (sizeInBytes: number) => {
		const chars =
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?"
		let result = ""
		for (let i = 0; i < sizeInBytes; i++) {
			result += chars.charAt(Math.floor(Math.random() * chars.length))
		}
		return result
	},
	echoData: async (data: string) => data
}

const stdio = new DenoIo(Deno.stdin.readable)
const child = new RPCChannel(stdio, { expose: largeDataAPI })
