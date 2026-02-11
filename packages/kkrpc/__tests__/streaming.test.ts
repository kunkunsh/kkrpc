/**
 * Streaming / AsyncIterable integration tests.
 *
 * ## Background
 *
 * kkrpc was originally request/response only — every RPC call returns a single
 * value. Streaming adds the ability for an RPC method to return an
 * `AsyncIterable` (typically an async generator). Instead of sending one
 * response, kkrpc detects the AsyncIterable and enters a streaming protocol:
 *
 *   1. The producer (server) sends an initial `response` with `{ __stream: true }`
 *      to tell the consumer (client) that stream messages will follow.
 *   2. Each `yield`ed value is sent as a `stream-chunk` message.
 *   3. When the generator finishes, a `stream-end` message is sent.
 *   4. If the generator throws, a `stream-error` message delivers the error.
 *   5. If the consumer breaks out of `for await`, the iterator's `return()` sends
 *      a `stream-cancel` message back, which aborts the producer's loop.
 *
 * On the consumer side, `await api.streamMethod()` resolves to an AsyncIterable
 * that the caller reads with `for await...of`. This feels natural in JS/TS and
 * provides proper lifecycle — cancellation on break, error propagation, cleanup
 * via finally blocks.
 *
 * ## What we're testing
 *
 * These tests verify the streaming protocol end-to-end over real WebSocket
 * connections (not mocks). Each test spins up a WebSocket server + client pair
 * on a unique port to avoid conflicts.
 *
 * - **Basic stream**: Values arrive in order and the stream completes.
 * - **Coexistence**: Streaming methods and regular request/response methods
 *   work on the same channel without interfering.
 * - **Error propagation**: A throw inside the generator reaches the consumer
 *   as a real Error, and chunks received before the error are not lost.
 * - **Consumer cancellation**: `break` inside `for await` sends `stream-cancel`
 *   to stop the producer, and the channel remains usable afterward.
 * - **Concurrent streams**: Multiple independent streams can run in parallel
 *   over a single channel, each delivering their own values.
 * - **Interceptor interaction**: Middleware wraps the handler call (which
 *   returns the AsyncIterable), not each chunk — verifying correct layering.
 * - **Timing / ordering**: Chunks produced with delays still arrive in order.
 * - **Edge case — empty stream**: A generator that yields nothing should
 *   complete immediately without errors.
 * - **Nested methods**: Streaming works through dot-path method resolution
 *   (e.g. `api.data.stream()`), same as regular nested RPC calls.
 */

import { describe, expect, test } from "bun:test"
import { WebSocketServer } from "ws"
import { WebSocketClientIO, WebSocketServerIO } from "../src/adapters/websocket.ts"
import { RPCChannel } from "../src/channel.ts"
import type { IoInterface } from "../src/interface.ts"
import type { RPCInterceptor } from "../src/middleware.ts"

// ---------------------------------------------------------------------------
// Helper: sleep
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Helper: create a WebSocket server/client pair for a test
//
// Each test gets its own port so tests can run in parallel without conflicts.
// The server creates an RPCChannel per connection that exposes `serverOptions.expose`.
// The returned `client()` function connects a new WebSocket client and returns
// the RPCChannel + typed API proxy.
// ---------------------------------------------------------------------------

function createTestPair<
	ServerAPI extends Record<string, any>,
	ClientAPI extends Record<string, any>
>(
	port: number,
	serverOptions: {
		expose: ServerAPI
		interceptors?: RPCInterceptor[]
		timeout?: number
	}
): {
	wss: WebSocketServer
	client: () => Promise<{
		rpc: RPCChannel<ClientAPI, ServerAPI, IoInterface>
		api: ServerAPI
		io: WebSocketClientIO
	}>
} {
	const wss = new WebSocketServer({ port })
	wss.on("connection", (ws: WebSocket) => {
		const serverIO = new WebSocketServerIO(ws)
		new RPCChannel<ServerAPI, ClientAPI>(serverIO, serverOptions)
	})

	return {
		wss,
		client: async () => {
			const io = new WebSocketClientIO({ url: `ws://localhost:${port}` })
			const rpc = new RPCChannel<ClientAPI, ServerAPI, IoInterface>(io, {
				timeout: serverOptions.timeout
			})
			const api = rpc.getAPI()
			return { rpc, api, io }
		}
	}
}

// ---------------------------------------------------------------------------
// Test API: a mix of streaming and regular methods
//
// - countdown: finite stream, yields numbers in descending order
// - echo: plain request/response method (used to verify coexistence)
// - failAfter: yields N values then throws (tests error mid-stream)
// - infinite: never-ending stream (tests consumer cancellation via break)
// - delayedChunks: yields with sleeps between chunks (tests ordering under delay)
// ---------------------------------------------------------------------------

type StreamAPI = {
	countdown(from: number): AsyncIterable<number>
	echo(msg: string): Promise<string>
	failAfter(n: number): AsyncIterable<number>
	infinite(): AsyncIterable<number>
	delayedChunks(count: number, delayMs: number): AsyncIterable<number>
}

const streamApiMethods: StreamAPI = {
	async *countdown(from: number) {
		for (let i = from; i >= 0; i--) {
			yield i
		}
	},
	echo: async (msg) => msg,
	async *failAfter(n: number) {
		for (let i = 0; i < n; i++) {
			yield i
		}
		throw new Error("stream failed intentionally")
	},
	async *infinite() {
		let i = 0
		while (true) {
			yield i++
			await sleep(10)
		}
	},
	async *delayedChunks(count: number, delayMs: number) {
		for (let i = 0; i < count; i++) {
			await sleep(delayMs)
			yield i
		}
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Streaming / AsyncIterable", () => {
	// The most basic case: call a streaming method, collect all yielded values,
	// and verify they arrive in the correct order and the stream completes.
	test("basic countdown stream", async () => {
		const PORT = 3090
		const { wss, client } = createTestPair<StreamAPI, {}>(PORT, {
			expose: streamApiMethods
		})

		try {
			const { api, io } = await client()
			const values: number[] = []

			for await (const n of await api.countdown(5)) {
				values.push(n as number)
			}

			expect(values).toEqual([5, 4, 3, 2, 1, 0])
			io.destroy()
		} finally {
			wss.close()
		}
	})

	// Streaming should not break regular request/response methods. This test
	// interleaves regular calls and stream consumption on the same channel to
	// confirm the two protocols coexist without interference.
	test("regular methods still work alongside streaming", async () => {
		const PORT = 3091
		const { wss, client } = createTestPair<StreamAPI, {}>(PORT, {
			expose: streamApiMethods
		})

		try {
			const { api, io } = await client()

			// Regular request/response call
			const result = await api.echo("hello")
			expect(result).toBe("hello")

			// Stream call
			const values: number[] = []
			for await (const n of await api.countdown(3)) {
				values.push(n as number)
			}
			expect(values).toEqual([3, 2, 1, 0])

			// Regular call again — channel is still functional
			const result2 = await api.echo("world")
			expect(result2).toBe("world")

			io.destroy()
		} finally {
			wss.close()
		}
	})

	// When the producer throws mid-stream, the error should be delivered to
	// the consumer via the stream-error message. Crucially, chunks received
	// *before* the error must not be lost — the consumer should see [0, 1, 2]
	// and then get the error on the next iteration.
	test("producer error propagates to consumer", async () => {
		const PORT = 3092
		const { wss, client } = createTestPair<StreamAPI, {}>(PORT, {
			expose: streamApiMethods
		})

		try {
			const { api, io } = await client()
			const values: number[] = []

			try {
				for await (const n of await api.failAfter(3)) {
					values.push(n as number)
				}
				expect.unreachable("should have thrown")
			} catch (error: unknown) {
				expect(error instanceof Error).toBe(true)
				if (error instanceof Error) {
					expect(error.message).toContain("stream failed intentionally")
				}
			}

			// Chunks yielded before the throw must still be collected
			expect(values).toEqual([0, 1, 2])

			io.destroy()
		} finally {
			wss.close()
		}
	})

	// The infinite() generator never stops on its own. The consumer must be
	// able to `break` out of the loop, which triggers the iterator's return()
	// method and sends a stream-cancel message to the producer. After
	// cancellation, the channel should remain fully operational for subsequent
	// calls — this confirms that cancel doesn't corrupt channel state.
	test("consumer cancellation via break", async () => {
		const PORT = 3093
		const { wss, client } = createTestPair<StreamAPI, {}>(PORT, {
			expose: streamApiMethods
		})

		try {
			const { api, io } = await client()
			const values: number[] = []

			for await (const n of await api.infinite()) {
				values.push(n as number)
				if (values.length >= 5) break // triggers stream-cancel
			}

			expect(values).toEqual([0, 1, 2, 3, 4])

			// Verify the channel is still usable after cancellation
			await sleep(50) // give server time to process the cancel
			const result = await api.echo("still works")
			expect(result).toBe("still works")

			io.destroy()
		} finally {
			wss.close()
		}
	})

	// Each stream gets its own request ID, so multiple streams can be active
	// at the same time over a single WebSocket connection. This test starts
	// two countdown streams concurrently and verifies each one delivers its
	// own complete sequence without mixing up values.
	test("concurrent streams", async () => {
		const PORT = 3094
		const { wss, client } = createTestPair<StreamAPI, {}>(PORT, {
			expose: streamApiMethods
		})

		try {
			const { api, io } = await client()

			const stream1 = api.countdown(3)
			const stream2 = api.countdown(2)

			const values1: number[] = []
			const values2: number[] = []

			await Promise.all([
				(async () => {
					for await (const n of await stream1) {
						values1.push(n as number)
					}
				})(),
				(async () => {
					for await (const n of await stream2) {
						values2.push(n as number)
					}
				})()
			])

			expect(values1).toEqual([3, 2, 1, 0])
			expect(values2).toEqual([2, 1, 0])

			io.destroy()
		} finally {
			wss.close()
		}
	})

	// Interceptors wrap the handler invocation — the handler returns an
	// AsyncIterable, and that's what the interceptor sees. The interceptor
	// does NOT run per-chunk. This test verifies the interceptor fires exactly
	// once (before + after) for a streaming call, not once per yielded value.
	test("stream with interceptor", async () => {
		const PORT = 3095
		const logged: string[] = []
		const logger: RPCInterceptor = async (ctx, next) => {
			logged.push(`call:${ctx.method}`)
			const result = await next()
			logged.push(`done:${ctx.method}`)
			return result
		}

		const { wss, client } = createTestPair<StreamAPI, {}>(PORT, {
			expose: streamApiMethods,
			interceptors: [logger]
		})

		try {
			const { api, io } = await client()
			const values: number[] = []

			for await (const n of await api.countdown(2)) {
				values.push(n as number)
			}

			expect(values).toEqual([2, 1, 0])
			// One call/done pair, not three (one per chunk)
			expect(logged).toEqual(["call:countdown", "done:countdown"])

			io.destroy()
		} finally {
			wss.close()
		}
	})

	// When the producer yields with delays between chunks, the consumer must
	// still receive all values in the original order. This guards against
	// race conditions in the queue-based chunk buffering.
	test("delayed chunks arrive in order", async () => {
		const PORT = 3096
		const { wss, client } = createTestPair<StreamAPI, {}>(PORT, {
			expose: streamApiMethods
		})

		try {
			const { api, io } = await client()
			const values: number[] = []

			for await (const n of await api.delayedChunks(5, 20)) {
				values.push(n as number)
			}

			expect(values).toEqual([0, 1, 2, 3, 4])

			io.destroy()
		} finally {
			wss.close()
		}
	})

	// Edge case: a generator that yields zero values should still send
	// stream-end, and the consumer's for-await loop should complete
	// immediately with an empty result.
	test("empty stream (generator yields nothing)", async () => {
		type EmptyAPI = { empty(): AsyncIterable<number> }
		const emptyApi: EmptyAPI = {
			async *empty() {
				// yields nothing
			}
		}

		const PORT = 3097
		const { wss, client } = createTestPair<EmptyAPI, {}>(PORT, {
			expose: emptyApi
		})

		try {
			const { api, io } = await client()
			const values: number[] = []

			for await (const n of await api.empty()) {
				values.push(n as number)
			}

			expect(values).toEqual([])

			io.destroy()
		} finally {
			wss.close()
		}
	})

	// kkrpc resolves nested method paths like "data.stream" by walking the
	// API object. Streaming must work through this same path resolution —
	// this test confirms that a nested async generator is detected and
	// streamed correctly, just like a top-level one.
	test("nested method returns stream", async () => {
		type NestedAPI = {
			data: {
				stream(count: number): AsyncIterable<string>
			}
		}
		const nestedApi: NestedAPI = {
			data: {
				async *stream(count: number) {
					for (let i = 0; i < count; i++) {
						yield `item-${i}`
					}
				}
			}
		}

		const PORT = 3098
		const { wss, client } = createTestPair<NestedAPI, {}>(PORT, {
			expose: nestedApi
		})

		try {
			const { api, io } = await client()
			const values: string[] = []

			for await (const item of await api.data.stream(3)) {
				values.push(item as string)
			}

			expect(values).toEqual(["item-0", "item-1", "item-2"])

			io.destroy()
		} finally {
			wss.close()
		}
	})
})
