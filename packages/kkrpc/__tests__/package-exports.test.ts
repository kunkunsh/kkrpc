import { describe, expect, test } from "bun:test"

const stableEntries = [
	[".", () => import("../src/entries/mod.ts")],
	["./browser", () => import("../src/entries/browser-mod.ts")],
	["./deno", () => import("../src/entries/deno-mod.ts")],
	["./transport", () => import("../src/entries/transport.ts")],
	["./codecs", () => import("../src/entries/codecs.ts")],
	["./plugins", () => import("../src/entries/plugins.ts")],
	["./validation", () => import("../src/entries/validation.ts")],
	["./middleware", () => import("../src/entries/middleware.ts")],
	["./superjson", () => import("../src/entries/superjson.ts")],
	["./remote-refs", () => import("../src/entries/remote-refs.ts")],
	["./streaming", () => import("../src/entries/streaming.ts")],
	["./worker", () => import("../src/entries/worker.ts")],
	["./stdio", () => import("../src/entries/stdio.ts")],
	["./http", () => import("../src/entries/http.ts")],
	["./ws", () => import("../src/entries/ws.ts")],
	["./ws/hono", () => import("../src/entries/ws-hono.ts")],
	["./ws/elysia", () => import("../src/entries/ws-elysia.ts")],
	["./iframe", () => import("../src/entries/iframe.ts")],
	["./chrome-extension", () => import("../src/entries/chrome-extension.ts")],
	["./electron", () => import("../src/entries/electron.ts")],
	["./tauri", () => import("../src/entries/tauri.ts")],
	["./socketio", () => import("../src/entries/socketio.ts")],
	["./rabbitmq", () => import("../src/entries/rabbitmq.ts")],
	["./kafka", () => import("../src/entries/kafka.ts")],
	["./redis-streams", () => import("../src/entries/redis-streams.ts")],
	["./nats", () => import("../src/entries/nats.ts")],
	["./relay", () => import("../src/entries/relay.ts")],
	["./inspector", () => import("../src/entries/inspector.ts")]
] as const

const stableEntrySourceFiles = [
	"mod.ts",
	"browser-mod.ts",
	"deno-mod.ts",
	"transport.ts",
	"codecs.ts",
	"plugins.ts",
	"validation.ts",
	"middleware.ts",
	"superjson.ts",
	"remote-refs.ts",
	"streaming.ts",
	"worker.ts",
	"stdio.ts",
	"http.ts",
	"ws.ts",
	"ws-hono.ts",
	"ws-elysia.ts",
	"iframe.ts",
	"chrome-extension.ts",
	"electron.ts",
	"tauri.ts",
	"socketio.ts",
	"rabbitmq.ts",
	"kafka.ts",
	"redis-streams.ts",
	"nats.ts",
	"relay.ts",
	"inspector.ts"
] as const

const oldName = (...parts: string[]) => parts.join("")

const removedExportNames = new Set([
	oldName("Bun", "Io"),
	"ChromeExtensionContentScriptIO",
	"ChromeExtensionBackgroundIO",
	`Deno${"Io"}`,
	oldName("Electron", "IpcMainIO"),
	oldName("Electron", "IpcPreloadIO"),
	oldName("Electron", "IpcRendererIO"),
	oldName("Electron", "UtilityProcessChildIO"),
	oldName("Electron", "UtilityProcessIO"),
	oldName("Elysia", "WebSocket", "ServerIO"),
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
	oldName("WebSocket", "ClientIO"),
	oldName("WebSocket", "ServerIO"),
	oldName("Worker", "ChildIO"),
	oldName("Worker", "ParentIO"),
	"decodeMessage",
	"encodeMessage",
	"registerTransferHandler"
])

describe("stable package exports", () => {
	test("main entry exposes stable core API", async () => {
		const core = await import("../src/entries/mod.ts")

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
		expect(exportsMap[`./electron-${"ipc"}`]).toBeUndefined()
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
		expect(exportsMap[`./electron-${"ipc"}`]).toBeUndefined()

		for (const [key] of stableEntries.slice(1)) {
			expect(exportsMap[key], key).toBeDefined()
		}
	})

	test("stable entry source files live under src/entries", async () => {
		for (const file of stableEntrySourceFiles) {
			const rootFile = Bun.file(new URL(`../${file}`, import.meta.url))
			const entryFile = Bun.file(new URL(`../src/entries/${file}`, import.meta.url))

			expect(await rootFile.exists(), `${file} should not live in package root`).toBe(false)
			expect(await entryFile.exists(), `${file} should live in src/entries`).toBe(true)
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
			const source = await Bun.file(new URL(`../src/entries/${file}`, import.meta.url)).text()
			const exportLines = source
				.split("\n")
				.filter((line) => /^\s*export\b/.test(line) || /^\s*}\s+from\b/.test(line))
				.join("\n")

			for (const exportName of removedExportNames) {
				expect(exportLines.includes(exportName), `${file} exports ${exportName}`).toBe(false)
			}
			expect(
				exportLines.includes(oldName("src/", "interface")),
				`${file} exports classic interface`
			).toBe(false)
			expect(exportLines.includes("src/channel"), `${file} exports classic channel`).toBe(false)
			expect(
				exportLines.includes(oldName("src/", "serialization")),
				`${file} exports classic serialization`
			).toBe(false)
			expect(
				exportLines.includes("src/transfer-handlers"),
				`${file} exports classic transfer handlers`
			).toBe(false)
			expect(
				exportLines.includes(oldName("src/", "adapters")),
				`${file} exports classic adapters`
			).toBe(false)
		}
	})

	test("stable feature entries expose native helpers", async () => {
		const validation = await import("../src/entries/validation.ts")
		const middleware = await import("../src/entries/middleware.ts")
		const superjson = await import("../src/entries/superjson.ts")

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

		expect(source.includes('from "../validation.ts"'), "imports classic validation module").toBe(
			false
		)
		expect(
			source.includes('from "../standard-schema.ts"'),
			"imports classic standard schema module"
		).toBe(false)
		expect(source.includes('from "../channel.ts"'), "imports classic channel module").toBe(false)
		expect(source.includes('from "../interface.ts"'), "imports classic interface module").toBe(
			false
		)
	})

	test("deno entry avoids Node-specific stdio helpers", async () => {
		const source = await Bun.file(new URL("../src/entries/deno-mod.ts", import.meta.url)).text()

		expect(source.includes("src/next/stdio"), "deno-mod.ts exports stdio helpers").toBe(false)
		expect(source.includes("nodeStdioTransport"), "deno-mod.ts exports nodeStdioTransport").toBe(
			false
		)
		expect(source.includes("process"), "deno-mod.ts references process").toBe(false)
	})
})
