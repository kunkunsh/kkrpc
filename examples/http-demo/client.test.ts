import { apiImplementationNested } from "@kksh/demo-api"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHttpHandler } from "kkrpc/http"
import { runHttpDemoClient } from "./client"

describe("http-demo client", () => {
	let server: ReturnType<typeof Bun.serve>
	let url: string

	beforeAll(() => {
		const handler = createHttpHandler(apiImplementationNested)

		server = Bun.serve({
			port: 0,
			async fetch(req) {
				const requestUrl = new URL(req.url)
				if (requestUrl.pathname !== "/rpc") return new Response("Not found", { status: 404 })
				if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })
				return handler(req)
			}
		})
		url = `http://127.0.0.1:${server.port}/rpc`
	})

	afterAll(() => {
		server.stop()
	})

	test("runs the one-shot client flow against an explicit RPC URL", async () => {
		const result = await runHttpDemoClient(url)

		expect(result.echoResult).toBe("Hello RPC!")
		expect(result.sum).toBe(8)
		expect(result.product).toBe(24)
		expect(result.concurrentResults).toEqual([30, 200])
		expect(result.allCorrect).toBe(true)
	})
})
