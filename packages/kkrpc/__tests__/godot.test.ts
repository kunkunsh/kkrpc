import { describe, expect, test } from "bun:test"
import { godotChildProcessTransport, godotStdioTransport } from "../src/entries/godot.ts"
import type {
	GodotChildProcessBinding,
	GodotChildProcessPipe,
	GodotStdioBinding
} from "../src/entries/godot.ts"
import { expose, type RPCMessage } from "../src/entries/mod.ts"

function createGodotHarness(input: string[]) {
	const scheduled: Array<() => void> = []
	const output: string[] = []
	const binding: GodotStdioBinding = {
		OS: { read_string_from_stdin: () => input.shift() ?? "" },
		print: (line) => output.push(line)
	}
	return {
		binding,
		output,
		schedule(callback: () => void) {
			scheduled.push(callback)
		},
		runNext() {
			scheduled.shift()?.()
		},
		get scheduledReads() {
			return scheduled.length
		}
	}
}

function createGodotChildHarness(chunks: string[]) {
	const scheduled: Array<() => void> = []
	const writes: string[] = []
	let running = true
	let flushes = 0
	let closes = 0
	let kills = 0
	const encoder = new TextEncoder()
	class FakePackedByteArray {
		constructor(private readonly bytes: number[]) {}
		size() {
			return this.bytes.length
		}
		get(index: number) {
			return this.bytes[index] ?? 0
		}
		get_string_from_utf8() {
			return new TextDecoder().decode(new Uint8Array(this.bytes))
		}
	}
	const pipe: GodotChildProcessPipe = {
		get_length: () => (chunks[0] ? encoder.encode(chunks[0]).byteLength : 0),
		get_buffer: () => {
			const value = chunks.shift() ?? ""
			return new FakePackedByteArray([...encoder.encode(value)])
		},
		store_line(line) {
			writes.push(line)
			return true
		},
		flush() {
			flushes++
		},
		close() {
			closes++
		}
	}
	const binding: GodotChildProcessBinding = {
		PackedByteArray: FakePackedByteArray,
		OS: {
			execute_with_pipe: () =>
				({
					is_empty: () => false,
					get: (key: "stdio" | "pid") => (key === "stdio" ? pipe : 42)
				}) as ReturnType<GodotChildProcessBinding["OS"]["execute_with_pipe"]>,
			is_process_running: () => running,
			get_process_exit_code: () => 0,
			kill: () => {
				kills++
			}
		}
	}
	return {
		binding,
		writes,
		get flushes() {
			return flushes
		},
		get closes() {
			return closes
		},
		get kills() {
			return kills
		},
		finish() {
			running = false
		},
		schedule(callback: () => void) {
			scheduled.push(callback)
		},
		runNext() {
			scheduled.shift()?.()
		}
	}
}

describe("GodotJS stdio transport", () => {
	test("spawns and polls a Godot-owned child process", () => {
		const first: RPCMessage = { t: "r", id: "1", v: "first" }
		const second: RPCMessage = { t: "r", id: "2", v: "second" }
		const joined = `${JSON.stringify(first)}\nlog output\n${JSON.stringify(second)}\n`
		const harness = createGodotChildHarness([joined.slice(0, 8), joined.slice(8)])
		const invalid: string[] = []
		const transport = godotChildProcessTransport({
			path: "child",
			args: ["worker.js"],
			godot: harness.binding,
			schedule: (callback) => harness.schedule(callback),
			onInvalidFrame: (frame) => invalid.push(frame)
		})
		const messages: RPCMessage[] = []
		transport.subscribe((message) => messages.push(message))

		harness.runNext()

		expect(transport.pid).toBe(42)
		expect(messages).toEqual([first, second])
		expect(invalid).toEqual(["log output\n"])
	})

	test("writes, reports exit, and cleans up a Godot-owned child", async () => {
		const harness = createGodotChildHarness([])
		const transport = godotChildProcessTransport({
			path: "child",
			godot: harness.binding,
			schedule: (callback) => harness.schedule(callback)
		})
		let remotelyClosed = false
		transport.onClose?.(() => (remotelyClosed = true))
		transport.subscribe(() => {})
		const message: RPCMessage = { t: "r", id: "1", v: "ok" }

		await transport.send(message)
		expect(harness.writes).toEqual([JSON.stringify(message)])
		expect(harness.flushes).toBe(1)
		harness.finish()
		harness.runNext()
		expect(remotelyClosed).toBe(true)
		expect(harness.closes).toBe(1)

		const runningHarness = createGodotChildHarness([])
		const runningTransport = godotChildProcessTransport({
			path: "child",
			godot: runningHarness.binding
		})
		runningTransport.close?.()
		expect(runningHarness.closes).toBe(1)
		expect(runningHarness.kills).toBe(1)
	})

	test("reads Godot stdin one frame per scheduled task", () => {
		const first: RPCMessage = { t: "r", id: "1", v: "first" }
		const second: RPCMessage = { t: "r", id: "2", v: "second" }
		const harness = createGodotHarness([
			JSON.stringify(first),
			" ",
			"godot log output",
			"{invalid json",
			JSON.stringify(second)
		])
		const invalid: Array<[string, unknown?]> = []
		const transport = godotStdioTransport({
			godot: harness.binding,
			schedule: (callback) => harness.schedule(callback),
			onInvalidFrame: (frame, error) => invalid.push([frame, error])
		})
		const messages: RPCMessage[] = []
		const unsubscribe = transport.subscribe((message) => messages.push(message))

		expect(harness.scheduledReads).toBe(1)
		for (let index = 0; index < 5; index++) harness.runNext()

		expect(messages).toEqual([first, second])
		expect(invalid).toHaveLength(2)
		expect(invalid[0]?.[0]).toBe("godot log output\n")
		expect(invalid[0]?.[1]).toBeUndefined()
		expect(invalid[1]?.[1]).toBeInstanceOf(Error)
		unsubscribe()
		expect(harness.scheduledReads).toBe(1)
		harness.runNext()
		expect(harness.scheduledReads).toBe(0)
	})

	test("reports an empty Godot stdin read as a clean remote close", () => {
		const harness = createGodotHarness([""])
		const transport = godotStdioTransport({
			godot: harness.binding,
			schedule: (callback) => harness.schedule(callback)
		})
		let closed: Error | undefined | "pending" = "pending"
		transport.onClose?.((reason) => (closed = reason))
		transport.subscribe(() => {})

		harness.runNext()

		expect(closed).toBeUndefined()
		expect(harness.scheduledReads).toBe(0)
	})

	test("writes Godot stdout as one JSON line", async () => {
		const harness = createGodotHarness([])
		const transport = godotStdioTransport({ godot: harness.binding })
		const message: RPCMessage = { t: "r", id: "1", v: "ok" }

		await transport.send(message)

		expect(harness.output).toEqual([JSON.stringify(message)])
		transport.close?.()
		await expect(transport.send(message)).rejects.toThrow("closed")
	})

	test("lets async handlers settle before the next Godot stdin read", async () => {
		const request: RPCMessage = { t: "q", id: "1", op: "call", p: ["double"], a: [4] }
		const harness = createGodotHarness([JSON.stringify(request)])
		const controller = expose(
			{
				async double(value: number) {
					await Promise.resolve()
					return value * 2
				}
			},
			godotStdioTransport({
				godot: harness.binding,
				schedule: (callback) => harness.schedule(callback)
			})
		)

		harness.runNext()
		expect(harness.output).toEqual([])
		await Bun.sleep(0)
		expect(JSON.parse(harness.output[0]!)).toMatchObject({ t: "r", id: "1", v: 8 })
		controller.dispose()
	})
})
