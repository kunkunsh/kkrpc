import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHttpHandler, httpClientTransport } from "../src/entries/http.ts"
import { RPCChannel, wrap } from "../src/entries/mod.ts"
import { RPCChannel as RemoteRefRPCChannel, proxy } from "../src/entries/remote-refs.ts"
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

	test("structurally invalid RPC request returns 400", async () => {
		const response = await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ t: "q", id: "bad" })
		})
		expect(response.status).toBe(400)
	})

	test("remote reference arguments are rejected as unsupported unary HTTP requests", async () => {
		const response = await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				t: "q",
				id: "callback-id",
				op: "call",
				p: ["echo"],
				a: [{ __kkrpc_ref__: true, id: "callback-arg", kind: "function" }]
			})
		})
		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			t: "r",
			id: "callback-id",
			e: { m: "HTTP transport does not support remote references" }
		})
	})

	test("async iterable arguments are rejected as unsupported unary HTTP requests", async () => {
		const response = await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				t: "q",
				id: "stream-id",
				op: "call",
				p: ["echo"],
				a: [
					{ __kkrpc_next_arg__: "value", v: { __kkrpc_next_stream__: "async-iterable", id: "s1" } }
				]
			})
		})
		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			t: "r",
			id: "stream-id",
			e: { m: "HTTP transport does not support async iterable streams" }
		})
	})

	test("legacy callback envelopes are rejected as unsupported unary HTTP requests", async () => {
		const response = await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				t: "q",
				id: "callback-envelope-id",
				op: "call",
				p: ["echo"],
				a: [{ __kkrpc_next_arg__: "callback", id: "callback-arg" }]
			})
		})
		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			t: "r",
			id: "callback-envelope-id",
			e: { m: "HTTP transport does not support callback arguments" }
		})
	})

	test("client transport rejects remote reference arguments before fetch", async () => {
		let called = false
		const fetchStub: typeof fetch = Object.assign(
			async (..._args: Parameters<typeof fetch>) => {
				called = true
				throw new Error("fetch should not be called")
			},
			{ preconnect: fetch.preconnect }
		)
		const transport = httpClientTransport({
			url: `${baseUrl}/rpc`,
			fetch: fetchStub
		})

		await expect(
			transport.send({
				t: "q",
				id: "callback-id",
				op: "call",
				p: ["echo"],
				a: [{ __kkrpc_ref__: true, id: "callback-arg", kind: "function" }]
			})
		).rejects.toThrow("HTTP transport does not support remote references")
		expect(called).toBe(false)
	})

	test("HTTP channel rejects callback arguments before fetch", async () => {
		let called = false
		const fetchStub: typeof fetch = Object.assign(
			async (..._args: Parameters<typeof fetch>) => {
				called = true
				throw new Error("fetch should not be called")
			},
			{ preconnect: fetch.preconnect }
		)
		const channel = new RPCChannel<object, { accept(callback: () => string): Promise<void> }>(
			httpClientTransport({
				url: `${baseUrl}/rpc`,
				fetch: fetchStub
			})
		)
		try {
			await expect(channel.getAPI().accept(() => "nope")).rejects.toThrow(
				"HTTP transport does not support callback arguments"
			)
			expect(called).toBe(false)
		} finally {
			channel.destroy()
		}
	})

	test("HTTP remote-ref entry rejects explicit proxy refs before fetch", async () => {
		let called = false
		const fetchStub: typeof fetch = Object.assign(
			async (..._args: Parameters<typeof fetch>) => {
				called = true
				throw new Error("fetch should not be called")
			},
			{ preconnect: fetch.preconnect }
		)
		const channel = new RemoteRefRPCChannel<object, { accept(callback: () => string): Promise<void> }>(
			httpClientTransport({
				url: `${baseUrl}/rpc`,
				fetch: fetchStub
			})
		)

		try {
			await expect(channel.getAPI().accept(proxy(() => "nope"))).rejects.toThrow(
				"RPC channel does not support remote references"
			)
			expect(called).toBe(false)
		} finally {
			channel.destroy()
		}
	})

	test("client transport rejects remote reference values before fetch", async () => {
		let called = false
		const fetchStub: typeof fetch = Object.assign(
			async (..._args: Parameters<typeof fetch>) => {
				called = true
				throw new Error("fetch should not be called")
			},
			{ preconnect: fetch.preconnect }
		)
		const transport = httpClientTransport({
			url: `${baseUrl}/rpc`,
			fetch: fetchStub
		})

		await expect(
			transport.send({
				t: "q",
				id: "callback-value-id",
				op: "set",
				p: ["callback"],
				v: { __kkrpc_ref__: true, id: "callback-value", kind: "function" }
			})
		).rejects.toThrow("HTTP transport does not support remote references")
		expect(called).toBe(false)
	})

	test("client transport rejects async iterable arguments before fetch", async () => {
		let called = false
		const fetchStub: typeof fetch = Object.assign(
			async (..._args: Parameters<typeof fetch>) => {
				called = true
				throw new Error("fetch should not be called")
			},
			{ preconnect: fetch.preconnect }
		)
		const transport = httpClientTransport({
			url: `${baseUrl}/rpc`,
			fetch: fetchStub
		})

		await expect(
			transport.send({
				t: "q",
				id: "stream-id",
				op: "call",
				p: ["echo"],
				a: [
					{
						__kkrpc_next_arg__: "value",
						v: { __kkrpc_next_stream__: "async-iterable", id: "s1" }
					}
				]
			})
		).rejects.toThrow("HTTP transport does not support async iterable streams")
		expect(called).toBe(false)
	})

	test("handler rejects async iterable results because HTTP cannot continue streams", async () => {
		const handler = createHttpHandler({
			async *numbers() {
				yield 1
			}
		})

		const response = await handler(
			new Request("http://127.0.0.1/rpc", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ t: "q", id: "stream-result-id", op: "call", p: ["numbers"], a: [] })
			})
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			t: "r",
			id: "stream-result-id",
			e: { m: "HTTP transport does not support async iterable streams" }
		})
	})

	test("handler rejects remote reference response values because HTTP cannot keep refs alive", async () => {
		const handler = createHttpHandler({
			createToast: () => ({ __kkrpc_ref__: true, id: "returned-ref", kind: "function" })
		})

		const response = await handler(
			new Request("http://127.0.0.1/rpc", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ t: "q", id: "ref-result-id", op: "call", p: ["createToast"], a: [] })
			})
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			t: "r",
			id: "ref-result-id",
				e: { m: "HTTP transport does not support remote references" }
		})
	})

	test("handler rejects function response values because HTTP cannot serialize references", async () => {
		const handler = createHttpHandler({
			createCallback: () => () => "not-serializable"
		})

		const response = await handler(
			new Request("http://127.0.0.1/rpc", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ t: "q", id: "function-result-id", op: "call", p: ["createCallback"], a: [] })
			})
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			t: "r",
			id: "function-result-id",
			e: { m: "HTTP transport does not support function values" }
		})
	})

	test("handler rejects remote reference envelopes in error custom fields", async () => {
		const handler = createHttpHandler({
			fail: () => {
				const error = new Error("recoverable") as Error & {
					recover: { __kkrpc_ref__: true; id: string; kind: "function" }
				}
				error.recover = { __kkrpc_ref__: true, id: "recover-ref", kind: "function" }
				throw error
			}
		})

		const response = await handler(
			new Request("http://127.0.0.1/rpc", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ t: "q", id: "error-ref-id", op: "call", p: ["fail"], a: [] })
			})
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			t: "r",
			id: "error-ref-id",
			e: { m: "HTTP transport does not support remote references" }
		})
	})

	test("client transport rejects legacy callback envelopes before fetch", async () => {
		let called = false
		const fetchStub: typeof fetch = Object.assign(
			async (..._args: Parameters<typeof fetch>) => {
				called = true
				throw new Error("fetch should not be called")
			},
			{ preconnect: fetch.preconnect }
		)
		const transport = httpClientTransport({
			url: `${baseUrl}/rpc`,
			fetch: fetchStub
		})

		await expect(
			transport.send({
				t: "q",
				id: "legacy-callback-id",
				op: "call",
				p: ["echo"],
				a: [{ nested: { __kkrpc_next_arg__: "callback", id: "legacy-callback" } }]
			})
		).rejects.toThrow("HTTP transport does not support callback arguments")
		expect(called).toBe(false)
	})

	test("handler timeout returns 504 with RPC error response", async () => {
		const handler = createHttpHandler(
			{
				hang: () => new Promise(() => {})
			},
			{ timeout: 5 }
		)
		const response = await Promise.race([
			handler(
				new Request("http://127.0.0.1/rpc", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ t: "q", id: "timeout-id", op: "call", p: ["hang"], a: [] })
				})
			),
			new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50))
		])

		expect(response).toBeInstanceOf(Response)
		if (!(response instanceof Response)) return
		expect(response.status).toBe(504)
		expect(await response.json()).toMatchObject({
			t: "r",
			id: "timeout-id",
			e: { n: "RPCTimeoutError" }
		})
	})

	test("client preserves RPC errors returned with non-OK HTTP statuses", async () => {
		const handler = createHttpHandler(
			{
				hang: () => new Promise(() => {})
			},
			{ timeout: 5 }
		)
		const fetchStub: typeof fetch = Object.assign(
			(request: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
				handler(new Request(request, init)),
			{ preconnect: fetch.preconnect }
		)
		const api = wrap<{ hang(): Promise<never> }>(
			httpClientTransport({
				url: "http://127.0.0.1/rpc",
				fetch: fetchStub
			})
		)

		await expect(api.hang()).rejects.toMatchObject({ name: "RPCTimeoutError" })
	})
})
