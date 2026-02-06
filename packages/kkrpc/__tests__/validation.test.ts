import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { WebSocketServer } from "ws"
import { z } from "zod"
import { RPCChannel } from "../src/channel.ts"
import { WebSocketClientIO, WebSocketServerIO } from "../src/adapters/websocket.ts"
import type { IoInterface } from "../src/interface.ts"
import { serializeError, deserializeError } from "../src/serialization.ts"
import {
	lookupValidator,
	runValidation,
	RPCValidationError,
	isRPCValidationError,
	defineMethod,
	defineAPI,
	extractValidators,
	type RPCValidators,
	type InferAPI
} from "../src/validation.ts"

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("lookupValidator", () => {
	const validators = {
		echo: { input: z.tuple([z.string()]) },
		add: { input: z.tuple([z.number(), z.number()]), output: z.number() },
		math: {
			grade1: {
				add: { input: z.tuple([z.number(), z.number()]), output: z.number() }
			}
		}
	}

	test("finds top-level method validator", () => {
		const v = lookupValidator(validators, "add")
		expect(v).toBeDefined()
		expect(v!.input).toBeDefined()
		expect(v!.output).toBeDefined()
	})

	test("finds nested method validator", () => {
		const v = lookupValidator(validators, "math.grade1.add")
		expect(v).toBeDefined()
		expect(v!.input).toBeDefined()
	})

	test("returns undefined for non-existent path", () => {
		expect(lookupValidator(validators, "nonExistent")).toBeUndefined()
		expect(lookupValidator(validators, "math.grade99.add")).toBeUndefined()
	})

	test("returns undefined when validators is undefined", () => {
		expect(lookupValidator(undefined, "add")).toBeUndefined()
	})

	test("returns undefined for namespace node (not a leaf)", () => {
		expect(lookupValidator(validators, "math")).toBeUndefined()
		expect(lookupValidator(validators, "math.grade1")).toBeUndefined()
	})
})

describe("runValidation", () => {
	test("passes valid data", async () => {
		const result = await runValidation(z.number(), 42)
		expect(result.success).toBe(true)
		if (result.success) expect(result.value).toBe(42)
	})

	test("rejects invalid data", async () => {
		const result = await runValidation(z.number(), "not a number")
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.issues.length).toBeGreaterThan(0)
		}
	})

	test("returns success when schema is undefined (no-op)", async () => {
		const result = await runValidation(undefined, "anything")
		expect(result.success).toBe(true)
	})

	test("validates tuples", async () => {
		const schema = z.tuple([z.number(), z.number()])
		const good = await runValidation(schema, [1, 2])
		expect(good.success).toBe(true)

		const bad = await runValidation(schema, ["a", 2])
		expect(bad.success).toBe(false)
	})

	test("validates objects", async () => {
		const schema = z.object({ name: z.string(), age: z.number() })
		const good = await runValidation(schema, { name: "Alice", age: 30 })
		expect(good.success).toBe(true)

		const bad = await runValidation(schema, { name: "Alice", age: "thirty" })
		expect(bad.success).toBe(false)
	})
})

describe("RPCValidationError", () => {
	test("constructs with correct properties", () => {
		const err = new RPCValidationError("input", "add", [
			{ message: "Expected number" }
		])
		expect(err.name).toBe("RPCValidationError")
		expect(err.phase).toBe("input")
		expect(err.method).toBe("add")
		expect(err.issues).toHaveLength(1)
		expect(err.message).toContain("input")
		expect(err.message).toContain("add")
	})

	test("survives serializeError / deserializeError round-trip", () => {
		const original = new RPCValidationError("output", "math.grade1.add", [
			{ message: "Expected number", path: [0] }
		])
		const serialized = serializeError(original)
		const deserialized = deserializeError(serialized)

		expect(deserialized.name).toBe("RPCValidationError")
		expect(deserialized.message).toBe(original.message)
		expect(isRPCValidationError(deserialized)).toBe(true)
		if (isRPCValidationError(deserialized)) {
			expect(deserialized.phase).toBe("output")
			expect(deserialized.method).toBe("math.grade1.add")
			expect(deserialized.issues).toHaveLength(1)
			expect(deserialized.issues[0].message).toBe("Expected number")
		}
	})

	test("isRPCValidationError type guard", () => {
		const err = new RPCValidationError("input", "echo", [{ message: "bad" }])
		expect(isRPCValidationError(err)).toBe(true)
		expect(isRPCValidationError(new Error("normal error"))).toBe(false)
		expect(isRPCValidationError("string")).toBe(false)
	})
})

describe("defineMethod / defineAPI / extractValidators", () => {
	test("defineMethod creates a callable function with metadata", async () => {
		const add = defineMethod(
			{ input: z.tuple([z.number(), z.number()]), output: z.number() },
			async (a, b) => a + b
		)

		// Callable
		expect(await add(1, 2)).toBe(3)

		// Has metadata
		expect(add["~validators"]).toBeDefined()
		expect(add["~validators"].input).toBeDefined()
		expect(add["~validators"].output).toBeDefined()
	})

	test("extractValidators collects validators from nested API", () => {
		const api = defineAPI({
			echo: defineMethod(
				{ input: z.tuple([z.string()]), output: z.string() },
				async (msg) => msg
			),
			math: {
				add: defineMethod(
					{ input: z.tuple([z.number(), z.number()]), output: z.number() },
					async (a, b) => a + b
				)
			}
		})

		const validators = extractValidators(api)
		expect(validators).toBeDefined()
		// Use lookupValidator to verify the extracted structure
		expect(lookupValidator(validators, "echo")).toBeDefined()
		expect(lookupValidator(validators, "echo")!.input).toBeDefined()
		expect(lookupValidator(validators, "echo")!.output).toBeDefined()
		expect(lookupValidator(validators, "math.add")).toBeDefined()
		expect(lookupValidator(validators, "math.add")!.input).toBeDefined()
	})

	test("extractValidators skips plain functions without metadata", () => {
		const api = {
			plain: async (x: number) => x * 2,
			validated: defineMethod(
				{ input: z.tuple([z.number(), z.number()]), output: z.number() },
				async (a, b) => a + b
			)
		}
		const validators = extractValidators(api)
		expect(lookupValidator(validators, "plain")).toBeUndefined()
		expect(lookupValidator(validators, "validated")).toBeDefined()
	})
})

// ---------------------------------------------------------------------------
// Integration tests — full RPC round-trip with Zod validation
// ---------------------------------------------------------------------------

type TestAPI = {
	echo(message: string): Promise<string>
	add(a: number, b: number): Promise<number>
	createUser(user: { name: string; email: string }): Promise<{ id: string; name: string; email: string }>
	math: {
		multiply(a: number, b: number): Promise<number>
		divide(a: number, b: number): Promise<number>
	}
}

const testApiMethods: TestAPI = {
	echo: async (message) => message,
	add: async (a, b) => a + b,
	createUser: async (user) => ({ id: "123", ...user }),
	math: {
		multiply: async (a, b) => a * b,
		divide: async (a, b) => a / b
	}
}

const testValidators: RPCValidators<TestAPI> = {
	echo: {
		input: z.tuple([z.string()]),
		output: z.string()
	},
	add: {
		input: z.tuple([z.number(), z.number()]),
		output: z.number()
	},
	createUser: {
		input: z.tuple([z.object({ name: z.string().min(1), email: z.string().email() })]),
		output: z.object({ id: z.string(), name: z.string(), email: z.string() })
	},
	math: {
		multiply: {
			input: z.tuple([z.number(), z.number()]),
			output: z.number()
		},
		divide: {
			input: z.tuple([z.number(), z.number().refine((n) => n !== 0, "Divisor cannot be zero")]),
			output: z.number()
		}
	}
}

const PORT = 3099
let wss: WebSocketServer

beforeAll(() => {
	wss = new WebSocketServer({ port: PORT })
	wss.on("connection", (ws: WebSocket) => {
		const serverIO = new WebSocketServerIO(ws)
		new RPCChannel<TestAPI, TestAPI>(serverIO, {
			expose: testApiMethods,
			validators: testValidators
		})
	})
})

afterAll(() => {
	wss.close()
})

function createClient() {
	const clientIO = new WebSocketClientIO({ url: `ws://localhost:${PORT}` })
	const rpc = new RPCChannel<{}, TestAPI, IoInterface>(clientIO)
	return { io: clientIO, api: rpc.getAPI() }
}

/**
 * Assert that a caught error is an RPCValidationError with expected properties.
 */
function expectValidationError(
	error: unknown,
	phase: "input" | "output",
	method?: string
): asserts error is RPCValidationError {
	expect(isRPCValidationError(error)).toBe(true)
	if (!isRPCValidationError(error)) throw error
	expect(error.phase).toBe(phase)
	if (method) expect(error.method).toBe(method)
	expect(error.issues.length).toBeGreaterThan(0)
}

describe("Integration: Zod validation over RPC", () => {
	test("valid calls pass through", async () => {
		const { io, api } = createClient()
		try {
			expect(await api.echo("hello")).toBe("hello")
			expect(await api.add(10, 20)).toBe(30)
			expect(await api.math.multiply(3, 4)).toBe(12)
			expect(await api.math.divide(10, 2)).toBe(5)
			const user = await api.createUser({ name: "Alice", email: "alice@test.com" })
			expect(user).toEqual({ id: "123", name: "Alice", email: "alice@test.com" })
		} finally {
			io.destroy()
		}
	})

	test("rejects wrong argument types", async () => {
		const { io, api } = createClient()
		try {
			// @ts-expect-error — intentionally sending wrong types to test validation
			await api.add("not", "numbers")
			expect.unreachable("should have thrown")
		} catch (error: unknown) {
			expectValidationError(error, "input", "add")
		} finally {
			io.destroy()
		}
	})

	test("rejects invalid input on nested method", async () => {
		const { io, api } = createClient()
		try {
			// @ts-expect-error — intentionally sending wrong types to test validation
			await api.math.multiply("bad", 2)
			expect.unreachable("should have thrown")
		} catch (error: unknown) {
			expectValidationError(error, "input", "math.multiply")
		} finally {
			io.destroy()
		}
	})

	test("rejects invalid email with .email() refinement", async () => {
		const { io, api } = createClient()
		try {
			await api.createUser({ name: "Bob", email: "not-an-email" })
			expect.unreachable("should have thrown")
		} catch (error: unknown) {
			expectValidationError(error, "input")
		} finally {
			io.destroy()
		}
	})

	test("rejects empty name with .min(1) refinement", async () => {
		const { io, api } = createClient()
		try {
			await api.createUser({ name: "", email: "valid@test.com" })
			expect.unreachable("should have thrown")
		} catch (error: unknown) {
			expectValidationError(error, "input")
		} finally {
			io.destroy()
		}
	})

	test("rejects division by zero with .refine()", async () => {
		const { io, api } = createClient()
		try {
			await api.math.divide(10, 0)
			expect.unreachable("should have thrown")
		} catch (error: unknown) {
			expectValidationError(error, "input", "math.divide")
			if (isRPCValidationError(error)) {
				const messages = error.issues.map((i) => i.message)
				expect(messages).toContain("Divisor cannot be zero")
			}
		} finally {
			io.destroy()
		}
	})

	test("output validation catches wrong return type", async () => {
		const badPort = 3098
		const badWss = new WebSocketServer({ port: badPort })

		type BadAPI = { getName(): Promise<string> }
		badWss.on("connection", (ws: WebSocket) => {
			const serverIO = new WebSocketServerIO(ws)
			new RPCChannel<BadAPI, BadAPI>(serverIO, {
				expose: { getName: async () => 42 as unknown as string },
				validators: { getName: { output: z.string() } }
			})
		})

		const clientIO = new WebSocketClientIO({ url: `ws://localhost:${badPort}` })
		const rpc = new RPCChannel<{}, BadAPI, IoInterface>(clientIO)
		const api = rpc.getAPI()

		try {
			await api.getName()
			expect.unreachable("should have thrown")
		} catch (error: unknown) {
			expectValidationError(error, "output")
		} finally {
			clientIO.destroy()
			badWss.close()
		}
	})

	test("no validators = backward compatible behavior", async () => {
		const noValPort = 3097
		const noValWss = new WebSocketServer({ port: noValPort })

		noValWss.on("connection", (ws: WebSocket) => {
			const serverIO = new WebSocketServerIO(ws)
			new RPCChannel<TestAPI, TestAPI>(serverIO, { expose: testApiMethods })
		})

		const clientIO = new WebSocketClientIO({ url: `ws://localhost:${noValPort}` })
		const rpc = new RPCChannel<{}, TestAPI, IoInterface>(clientIO)
		const api = rpc.getAPI()

		try {
			expect(await api.add(1, 2)).toBe(3)
		} finally {
			clientIO.destroy()
			noValWss.close()
		}
	})

	test("defineMethod + extractValidators end-to-end", async () => {
		const defPort = 3096
		const defWss = new WebSocketServer({ port: defPort })

		const schemaApi = defineAPI({
			greet: defineMethod(
				{ input: z.tuple([z.string()]), output: z.string() },
				async (name) => `Hello, ${name}!`
			),
			math: {
				add: defineMethod(
					{ input: z.tuple([z.number(), z.number()]), output: z.number() },
					async (a, b) => a + b
				)
			}
		})

		type SchemaAPI = InferAPI<typeof schemaApi>

		defWss.on("connection", (ws: WebSocket) => {
			const serverIO = new WebSocketServerIO(ws)
			new RPCChannel(serverIO, {
				expose: schemaApi,
				validators: extractValidators(schemaApi)
			})
		})

		const clientIO = new WebSocketClientIO({ url: `ws://localhost:${defPort}` })
		const rpc = new RPCChannel<{}, SchemaAPI, IoInterface>(clientIO)
		const api = rpc.getAPI()

		try {
			expect(await api.greet("World")).toBe("Hello, World!")
			expect(await api.math.add(3, 4)).toBe(7)

			// Invalid input
			try {
				// @ts-expect-error — intentionally sending wrong types to test validation
				await api.greet(123)
				expect.unreachable("should have thrown")
			} catch (error: unknown) {
				expectValidationError(error, "input")
			}

			try {
				// @ts-expect-error — intentionally sending wrong types to test validation
				await api.math.add("x", "y")
				expect.unreachable("should have thrown")
			} catch (error: unknown) {
				expectValidationError(error, "input")
			}
		} finally {
			clientIO.destroy()
			defWss.close()
		}
	})
})
