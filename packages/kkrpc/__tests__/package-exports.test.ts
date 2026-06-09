import { describe, expect, test } from "bun:test"

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

		for (const key of [
			"./browser",
			"./deno",
			"./transport",
			"./codecs",
			"./plugins",
			"./validation",
			"./middleware",
			"./superjson",
			"./worker",
			"./stdio",
			"./http",
			"./ws",
			"./ws/hono",
			"./ws/elysia",
			"./iframe",
			"./chrome-extension",
			"./electron",
			"./tauri",
			"./socketio",
			"./rabbitmq",
			"./kafka",
			"./redis-streams",
			"./nats",
			"./relay",
			"./inspector"
		]) {
			expect(exportsMap[key], key).toBeDefined()
		}
	})
})
