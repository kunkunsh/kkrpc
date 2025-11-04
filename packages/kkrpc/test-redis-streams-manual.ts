#!/usr/bin/env bun
// Redis Streams manual test script for kkrpc
// Run with: bun run test-redis-streams-manual.ts

import { RedisStreamsIO } from "./src/adapters/redis-streams.ts"
import { RPCChannel } from "./src/channel.ts"

// Define API interfaces
interface ServerAPI {
	echo(message: string): Promise<string>
	add(a: number, b: number): Promise<number>
	multiply(a: number, b: number): Promise<number>
	getServerInfo(): Promise<{ type: string; version: string; timestamp: number }>
}

interface ClientAPI {
	getClientInfo(): Promise<{ type: string; version: string; timestamp: number }>
	process(data: number[]): Promise<number[]>
}

async function main() {
	console.log("🚀 Testing Redis Streams adapter for kkrpc")

	// Create server adapter
	const serverAdapter = new RedisStreamsIO({
		url: process.env.REDIS_URL || "redis://localhost:6379",
		stream: "kkrpc-test-stream-" + Math.random().toString(36).substring(2, 8),
		consumerGroup: "kkrpc-test-group",
		sessionId: "server-" + Math.random().toString(36).substring(2, 8),
		blockTimeout: 5000,
		maxLen: 1000 // Keep only last 1000 messages
	})

	// Create server RPC channel
	const serverRPC = new RPCChannel<ClientAPI, ServerAPI>(serverAdapter, {
		expose: {
			echo: async (message: string) => {
				console.log("📨 Server received echo:", message)
				return `Echo: ${message}`
			},
			add: async (a: number, b: number) => {
				console.log(`📨 Server received add: ${a} + ${b}`)
				return a + b
			},
			multiply: async (a: number, b: number) => {
				console.log(`📨 Server received multiply: ${a} * ${b}`)
				return a * b
			},
			getServerInfo: async () => {
				return {
					type: "Redis Streams Server",
					version: "1.0.0",
					timestamp: Date.now()
				}
			}
		}
	})

	// Wait a bit for server to be ready
	await new Promise(resolve => setTimeout(resolve, 1000))

	// Create client adapter
	const clientAdapter = new RedisStreamsIO({
		url: process.env.REDIS_URL || "redis://localhost:6379",
		stream: serverAdapter.getStream(),
		consumerGroup: serverAdapter.getConsumerGroup(),
		sessionId: "client-" + Math.random().toString(36).substring(2, 8),
		blockTimeout: 5000
	})

	// Create client RPC channel
	const clientRPC = new RPCChannel<ServerAPI, ClientAPI>(clientAdapter, {
		expose: {
			getClientInfo: async () => {
				return {
					type: "Redis Streams Client",
					version: "1.0.0",
					timestamp: Date.now()
				}
			},
			process: async (data: number[]) => {
				console.log("📨 Client received process:", data)
				return data.map(x => x * 2)
			}
		}
	})

	const serverAPI = clientRPC.getAPI()
	const clientAPI = serverRPC.getAPI()

	try {
		console.log("\n📡 Testing basic RPC calls...")

		// Test basic RPC calls
		const echoResult = await serverAPI.echo("Hello from Redis Streams!")
		console.log("✅ Echo result:", echoResult)

		const addResult = await serverAPI.add(15, 25)
		console.log("✅ Add result:", addResult)

		const multiplyResult = await serverAPI.multiply(6, 7)
		console.log("✅ Multiply result:", multiplyResult)

		console.log("\n🔄 Testing bidirectional communication...")

		// Test bidirectional communication
		const serverInfo = await serverAPI.getServerInfo()
		console.log("✅ Server info:", serverInfo)

		const clientInfo = await clientAPI.getClientInfo()
		console.log("✅ Client info:", clientInfo)

		const processData = await clientAPI.process([1, 2, 3, 4, 5])
		console.log("✅ Process result:", processData)

		console.log("\n⚡ Testing concurrent calls...")

		// Test concurrent calls
		const concurrentResults = await Promise.all([
			serverAPI.echo("Concurrent 1"),
			serverAPI.add(100, 200),
			serverAPI.multiply(10, 15),
			clientAPI.process([10, 20, 30])
		])

		console.log("✅ Concurrent results:", concurrentResults)

		console.log("\n📊 Getting stream information...")

		// Test stream info
		const streamInfo = await serverAdapter.getStreamInfo()
		console.log("✅ Stream info:", streamInfo)

		console.log("\n🎉 All tests passed! Redis Streams adapter is working correctly.")

	} catch (error) {
		console.error("❌ Test failed:", error)
	} finally {
		console.log("\n🧹 Cleaning up...")

		// Cleanup
		clientAdapter.destroy()
		serverAdapter.destroy()

		console.log("✅ Cleanup complete")
	}
}

// Handle process interruption
process.on('SIGINT', () => {
	console.log("\n\n🛑 Received SIGINT, exiting...")
	process.exit(0)
})

// Run the test
main().catch(console.error)