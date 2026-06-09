import { describe, expect, test } from "bun:test"

const stableEntries = [
	[".", () => import("../mod.ts")],
	["./browser", () => import("../browser-mod.ts")],
	["./deno", () => import("../deno-mod.ts")],
	["./transport", () => import("../transport.ts")],
	["./codecs", () => import("../codecs.ts")],
	["./plugins", () => import("../plugins.ts")],
	["./validation", () => import("../validation.ts")],
	["./middleware", () => import("../middleware.ts")],
	["./superjson", () => import("../superjson.ts")],
	["./worker", () => import("../worker.ts")],
	["./stdio", () => import("../stdio.ts")],
	["./http", () => import("../http.ts")],
	["./ws", () => import("../ws.ts")],
	["./ws/hono", () => import("../ws-hono.ts")],
	["./ws/elysia", () => import("../ws-elysia.ts")],
	["./iframe", () => import("../iframe.ts")],
	["./chrome-extension", () => import("../chrome-extension.ts")],
	["./electron", () => import("../electron.ts")],
	["./tauri", () => import("../tauri.ts")],
	["./socketio", () => import("../socketio.ts")],
	["./rabbitmq", () => import("../rabbitmq.ts")],
	["./kafka", () => import("../kafka.ts")],
	["./redis-streams", () => import("../redis-streams.ts")],
	["./nats", () => import("../nats.ts")],
	["./relay", () => import("../relay.ts")],
	["./inspector", () => import("../inspector.ts")]
] as const

const removedExportNames = new Set([
	"BunIo",
	"ChromeExtensionContentScriptIO",
	"ChromeExtensionBackgroundIO",
	"DenoIo",
	"ElectronIpcMainIO",
	"ElectronIpcPreloadIO",
	"ElectronIpcRendererIO",
	"ElectronUtilityProcessChildIO",
	"ElectronUtilityProcessIO",
	"ElysiaWebSocketServerIO",
	"HTTPClientIO",
	"HTTPServerIO",
	"IframeChildIO",
	"IframeParentIO",
	"IoInterface",
	"KafkaConsumerIO",
	"KafkaProducerIO",
	"NatsConsumerIO",
	"NatsProducerIO",
	"NodeIo",
	"RabbitMQConsumerIO",
	"RabbitMQProducerIO",
	"RedisStreamsConsumerIO",
	"RedisStreamsProducerIO",
	"SocketIOClientIO",
	"SocketIOServerIO",
	"TauriShellStdio",
	"WebSocketClientIO",
	"WebSocketServerIO",
	"WorkerChildIO",
	"WorkerParentIO",
	"decodeMessage",
	"encodeMessage",
	"registerTransferHandler"
])

describe("stable package exports", () => {
	test("main entry exposes stable core API", async () => {
		const core = await import("../mod.ts")

		expect(typeof core.RPCChannel).toBe("function")
		expect(typeof core.wrap).toBe("function")
		expect(typeof core.expose).toBe("function")
		expect(typeof core.dispose).toBe("function")
		expect(typeof core.transfer).toBe("function")
		expect("IoInterface" in core).toBe(false)
	})

	test("removed next and experiment entries are absent from package exports", async () => {
		const packageJson = await import("../package.json")
		const exportsMap = packageJson.default.exports as Record<string, unknown>

		expect(exportsMap["./next"]).toBeUndefined()
		expect(Object.keys(exportsMap).some((key) => key.startsWith("./next/"))).toBe(false)
		expect(exportsMap["./browser-lite"]).toBeUndefined()
		expect(exportsMap["./browser-mini"]).toBeUndefined()
		expect(exportsMap["./electron-ipc"]).toBeUndefined()
	})

	test("stable feature entries are present", async () => {
		const packageJson = await import("../package.json")
		const exportsMap = packageJson.default.exports as Record<string, unknown>

		for (const [key] of stableEntries.slice(1)) {
			expect(exportsMap[key], key).toBeDefined()
		}
	})

	test("stable entries do not expose classic API names", async () => {
		for (const [key, importEntry] of stableEntries) {
			const module = await importEntry()
			for (const exportName of Object.keys(module)) {
				expect(removedExportNames.has(exportName), `${key} exports ${exportName}`).toBe(false)
				expect(exportName.endsWith("IO"), `${key} exports ${exportName}`).toBe(false)
				expect(exportName.endsWith("Io"), `${key} exports ${exportName}`).toBe(false)
			}
		}
	})
})
