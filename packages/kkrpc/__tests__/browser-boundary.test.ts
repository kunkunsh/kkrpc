import { describe, expect, test } from "bun:test"

const forbidden = [
	"node:",
	"ws",
	"hono",
	"elysia",
	"socket.io",
	"amqplib",
	"kafkajs",
	"ioredis",
	"@nats-io/transport-node",
	"@tauri-apps/plugin-shell"
]

describe("browser-safe entries", () => {
	test("main entry bundles without optional peer dependencies", async () => {
		const output = await Bun.build({
			entrypoints: [new URL("../mod.ts", import.meta.url).pathname],
			target: "browser",
			format: "esm"
		})
		expect(output.success).toBe(true)
		const text = await output.outputs[0].text()
		for (const value of forbidden) expect(text.includes(value), value).toBe(false)
	})

	test("browser entry bundles without Node-only dependencies", async () => {
		const output = await Bun.build({
			entrypoints: [new URL("../browser-mod.ts", import.meta.url).pathname],
			target: "browser",
			format: "esm"
		})
		expect(output.success).toBe(true)
		const text = await output.outputs[0].text()
		for (const value of forbidden) expect(text.includes(value), value).toBe(false)
	})
})
