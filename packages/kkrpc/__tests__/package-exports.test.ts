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

const stableEntrySourceFiles = [
	"mod.ts",
	"browser-mod.ts",
	"deno-mod.ts",
	"http.ts",
	"chrome-extension.ts",
	"electron.ts",
	"socketio.ts",
	"rabbitmq.ts",
	"kafka.ts",
	"redis-streams.ts",
	"nats.ts",
	"validation.ts",
	"middleware.ts",
	"superjson.ts",
	"inspector.ts"
] as const

const removedExportNames = new Set([
	"BunIo",
	"ChromeExtensionContentScriptIO",
	"ChromeExtensionBackgroundIO",
	`Deno${"Io"}`,
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
	`Io${"Interface"}`,
	"KafkaConsumerIO",
	"KafkaProducerIO",
	"NatsConsumerIO",
	"NatsProducerIO",
	`Node${"Io"}`,
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
		expect(`Io${"Interface"}` in core).toBe(false)
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

	test("deno manifest mirrors stable package exports", async () => {
		const denoConfig = await import("../deno.json")
		const exportsMap = denoConfig.default.exports as Record<string, unknown>

		expect(exportsMap["./next"]).toBeUndefined()
		expect(Object.keys(exportsMap).some((key) => key.startsWith("./next/"))).toBe(false)
		expect(exportsMap["./browser-lite"]).toBeUndefined()
		expect(exportsMap["./browser-mini"]).toBeUndefined()
		expect(exportsMap["./electron-ipc"]).toBeUndefined()

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

	test("stable entry sources do not export classic API names", async () => {
		for (const file of stableEntrySourceFiles) {
			const source = await Bun.file(new URL(`../${file}`, import.meta.url)).text()
			const exportLines = source
				.split("\n")
				.filter((line) => /^\s*export\b/.test(line) || /^\s*}\s+from\b/.test(line))
				.join("\n")

			for (const exportName of removedExportNames) {
				expect(exportLines.includes(exportName), `${file} exports ${exportName}`).toBe(false)
			}
			expect(exportLines.includes("src/interface"), `${file} exports classic interface`).toBe(false)
			expect(exportLines.includes("src/channel"), `${file} exports classic channel`).toBe(false)
			expect(exportLines.includes("src/serialization"), `${file} exports classic serialization`).toBe(false)
			expect(exportLines.includes("src/transfer-handlers"), `${file} exports classic transfer handlers`).toBe(
				false
			)
			expect(exportLines.includes("src/adapters"), `${file} exports classic adapters`).toBe(false)
		}
	})

	test("stable feature entries expose native helpers", async () => {
		const validation = await import("../validation.ts")
		const middleware = await import("../middleware.ts")
		const superjson = await import("../superjson.ts")

		expect(typeof validation.validationPlugin).toBe("function")
		expect(typeof validation.defineAPI).toBe("function")
		expect(typeof validation.defineMethod).toBe("function")
		expect(typeof middleware.middlewarePlugin).toBe("function")
		expect(typeof superjson.superJsonCodec).toBe("function")
		expect(typeof superjson.superJsonLineCodec).toBe("function")
		expect(typeof superjson.superjsonCodec).toBe("function")
	})

	test("validation feature is self-contained from classic validation sources", async () => {
		const source = await Bun.file(new URL("../src/features/validation.ts", import.meta.url)).text()

		expect(source.includes('from "../validation.ts"'), "imports classic validation module").toBe(false)
		expect(source.includes('from "../standard-schema.ts"'), "imports classic standard schema module").toBe(
			false
		)
		expect(source.includes('from "../channel.ts"'), "imports classic channel module").toBe(false)
		expect(source.includes('from "../interface.ts"'), "imports classic interface module").toBe(false)
	})

	test("deno entry avoids Node-specific stdio helpers", async () => {
		const source = await Bun.file(new URL("../deno-mod.ts", import.meta.url)).text()

		expect(source.includes("src/next/stdio"), "deno-mod.ts exports stdio helpers").toBe(false)
		expect(source.includes("nodeStdioTransport"), "deno-mod.ts exports nodeStdioTransport").toBe(false)
		expect(source.includes("process"), "deno-mod.ts references process").toBe(false)
	})
})
