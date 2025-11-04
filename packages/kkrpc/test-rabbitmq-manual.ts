#!/usr/bin/env node
import { RabbitMQIO } from "./src/adapters/rabbitmq.ts"
import { RPCChannel } from "./src/channel.ts"

// Test API interface
interface TestAPI {
	echo(message: string): string
	add(a: number, b: number): number
}

async function manualTest() {
	console.log("🧪 Manual RabbitMQ Test")

	// Server setup
	const serverAdapter = new RabbitMQIO({
		url: process.env.RABBITMQ_URL || "amqp://admin:admin@localhost:5672",
		exchange: "kkrpc-test-exchange-" + Math.random().toString(36).substring(2, 8),
		sessionId: "server-" + Math.random().toString(36).substring(2, 8)
	})

	const testAPI: TestAPI = {
		echo: (msg) => `ECHO: ${msg}`,
		add: (a, b) => a + b
	}

	const serverChannel = new RPCChannel(serverAdapter, { expose: testAPI })

	// Wait for server setup
	await new Promise((resolve) => setTimeout(resolve, 2000))
	console.log("✅ Server ready")

	// Client setup (use same exchange as server)
	const clientAdapter = new RabbitMQIO({
		url: process.env.RABBITMQ_URL || "amqp://admin:admin@localhost:5672",
		exchange: serverAdapter.getExchange(), // Use same exchange as server
		sessionId: "client-" + Math.random().toString(36).substring(2, 8)
	})

	const clientChannel = new RPCChannel<{}, TestAPI>(clientAdapter)
	const api = clientChannel.getAPI()

	// Wait for client setup
	await new Promise((resolve) => setTimeout(resolve, 2000))
	console.log("✅ Client ready")

	// Test RPC calls
	try {
		const echoResult = await api.echo("Hello RabbitMQ!")
		console.log("📢 Echo result:", echoResult)

		const sumResult = await api.add(10, 25)
		console.log("➕ Add result:", sumResult)

		console.log("🎉 All tests passed!")
	} catch (error) {
		console.error("❌ Test failed:", error)
	}

	// Cleanup
	console.log("🧹 Starting cleanup...")

	// Signal destroy first to notify the other side
	await clientAdapter.signalDestroy()
	await serverAdapter.signalDestroy()

	// Destroy RPC channels (which will destroy adapters)
	clientChannel.destroy()
	serverChannel.destroy()

	console.log("🧹 Cleanup complete")
}

manualTest().catch(console.error)
