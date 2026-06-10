import { createServer } from "node:http"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Server as SocketIOServer } from "socket.io"
import { io as createSocketIOClient } from "socket.io-client"
import { RPCChannel } from "../src/entries/mod.ts"
import { socketIoTransport } from "../src/entries/socketio.ts"
import { apiMethods, type API } from "./scripts/api.ts"

let httpServer: ReturnType<typeof createServer>
let io: SocketIOServer
let url: string

beforeAll(() => {
	httpServer = createServer()
	io = new SocketIOServer(httpServer, {
		cors: {
			origin: "*",
			methods: ["GET", "POST"]
		}
	})

	io.on("connection", (socket) => {
		new RPCChannel<API, object>(socketIoTransport(socket), { expose: apiMethods })
	})

	httpServer.listen(0)
	const address = httpServer.address()
	if (address === null || typeof address === "string") throw new Error("missing Socket.IO port")
	url = `http://localhost:${address.port}`
})

afterAll(() => {
	io.close()
	httpServer.close()
})

test("Socket.IO RPC calls remote methods", async () => {
	const socket = createSocketIOClient(url)
	const client = new RPCChannel<object, API>(socketIoTransport(socket))
	const api = client.getAPI()

	try {
		expect(await api.add(5, 3)).toBe(8)
		expect(await api.math.grade2.multiply(4, 6)).toBe(24)
		expect(
			await Promise.all([
				api.add(10, 20),
				api.math.grade2.multiply(10, 20),
				api.add(30, 40),
				api.math.grade2.multiply(30, 40)
			])
		).toEqual([30, 200, 70, 1200])
	} finally {
		client.destroy()
	}
})

test("Socket.IO supports namespaces", async () => {
	const namespace = io.of("/test")
	namespace.on("connection", (socket) => {
		new RPCChannel<API, object>(socketIoTransport(socket), { expose: apiMethods })
	})

	const socket = createSocketIOClient(`${url}/test`)
	const client = new RPCChannel<object, API>(socketIoTransport(socket))
	const api = client.getAPI()

	try {
		expect(await api.add(15, 25)).toBe(40)
		expect(await api.math.grade2.multiply(7, 8)).toBe(56)
	} finally {
		client.destroy()
	}
})

test("Socket.IO supports concurrent clients", async () => {
	const clients = Array.from({ length: 5 }, () => {
		const socket = createSocketIOClient(url)
		return new RPCChannel<object, API>(socketIoTransport(socket))
	})

	try {
		const results = await Promise.all(clients.map((client) => client.getAPI().add(10, 20)))
		expect(results).toEqual([30, 30, 30, 30, 30])
	} finally {
		for (const client of clients) client.destroy()
	}
})
