import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import { createHttpHandler, httpClientTransport } from "../http.ts"
import { wrap } from "../mod.ts"
import { apiMethods, type API } from "./scripts/api.ts"

describe("HTTP RPC", () => {
	let server: ReturnType<typeof Bun.serve>
	let api: API
	let baseUrl: string

	beforeAll(() => {
		const handler = createHttpHandler(apiMethods)
		server = Bun.serve({
			port: 0,
			async fetch(req) {
				const url = new URL(req.url)
				if (url.pathname !== "/rpc") return new Response("Not found", { status: 404 })
				if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })
				return handler(req)
			}
		})
		baseUrl = `http://127.0.0.1:${server.port}`
		api = wrap<API>(httpClientTransport({ url: `${baseUrl}/rpc` }))
	})

	afterAll(() => {
		server.stop()
	})

	test("echo service", async () => {
		expect(await api.echo("Hello RPC!")).toBe("Hello RPC!")
	})

	test("math operations", async () => {
		expect(await api.math.grade1.add(5, 3)).toBe(8)
		expect(await api.math.grade2.multiply(4, 6)).toBe(24)
	})

	test("concurrent calls", async () => {
		const results = await Promise.all([
			api.math.grade1.add(10, 20),
			api.math.grade2.multiply(10, 20)
		])
		expect(results).toEqual([30, 200])
	})

	test("wrong method and wrong path stay HTTP errors", async () => {
		expect(await fetch(`${baseUrl}/invalid`).then((res) => res.status)).toBe(404)
		expect(await fetch(`${baseUrl}/rpc`, { method: "GET" }).then((res) => res.status)).toBe(405)
	})

	test("malformed request returns 400", async () => {
		const response = await fetch(`${baseUrl}/rpc`, { method: "POST", body: "not-json" })
		expect(response.status).toBe(400)
	})
})
