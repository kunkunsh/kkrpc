import { describe, expect, test } from "bun:test"
import { z } from "zod"

import { expose, wrap } from "../mod.ts"
import type { RPCMessage, Transport } from "../mod.ts"
import {
	defineAPI,
	defineMethod,
	extractValidators,
	isRPCValidationError,
	validationPlugin
} from "../validation.ts"

interface API {
	add(a: number, b: number): Promise<number>
	withCallback(a: number, callback: (value: number) => void): Promise<number>
	math: {
		double(value: number): Promise<number>
	}
}

interface ValidationErrorShape extends Error {
	phase?: unknown
	method?: unknown
	issues?: unknown
}

class MemoryTransport implements Transport<RPCMessage> {
	capabilities = { objectMode: true, transfer: true }
	peer?: MemoryTransport
	private listener?: (message: RPCMessage) => void
	send(message: RPCMessage): void {
		queueMicrotask(() => this.peer?.listener?.(message))
	}
	subscribe(listener: (message: RPCMessage) => void): () => void {
		this.listener = listener
		return () => {
			this.listener = undefined
		}
	}
}

function createPair() {
	const a = new MemoryTransport()
	const b = new MemoryTransport()
	a.peer = b
	b.peer = a
	return { a, b }
}

function createApi(): API {
	return {
		add: async (a, b) => a + b,
		withCallback: async (a, callback) => {
			callback(a + 1)
			return a
		},
		math: {
			double: async (value) => value * 2
		}
	}
}

describe("kkrpc validation plugin", () => {
	test("rejects invalid input", async () => {
		const { a, b } = createPair()
		const controller = expose(createApi(), b, {
			plugins: [
				validationPlugin({
					add: { input: z.tuple([z.number(), z.number()]), output: z.number() }
				})
			]
		})
		const api = wrap<API>(a)

		try {
			await expect(api.add("x" as unknown as number, 2)).rejects.toThrow("input validation failed")
		} finally {
			controller.dispose()
		}
	})

	test("rejects invalid output", async () => {
		const { a, b } = createPair()
		const broken = { add: async () => "bad" }
		const controller = expose(broken, b, {
			plugins: [validationPlugin({ add: { output: z.number() } })]
		})
		const api = wrap<{ add(): Promise<number> }>(a)

		try {
			await expect(api.add()).rejects.toThrow("output validation failed")
		} finally {
			controller.dispose()
		}
	})

	test("validates nested methods and filters callback args", async () => {
		const { a, b } = createPair()
		const controller = expose(createApi(), b, {
			plugins: [
				validationPlugin({
					withCallback: { input: z.tuple([z.number()]), output: z.number() },
					math: { double: { input: z.tuple([z.number()]), output: z.number() } }
				})
			]
		})
		const api = wrap<API>(a)
		let callbackValue = 0

		try {
			expect(await api.math.double(3)).toBe(6)
			expect(
				await api.withCallback(4, (value) => {
					callbackValue = value
				})
			).toBe(4)
			expect(callbackValue).toBe(5)
		} finally {
			controller.dispose()
		}
	})

	test("schema-first helpers produce validators", async () => {
		const apiImpl = defineAPI({
			echo: defineMethod(
				{ input: z.tuple([z.string()]), output: z.string() },
				async (value) => value.toUpperCase()
			)
		})
		const { a, b } = createPair()
		const controller = expose(apiImpl, b, {
			plugins: [validationPlugin(extractValidators(apiImpl))]
		})
		const api = wrap<{ echo(value: string): Promise<string> }>(a)

		try {
			expect(await api.echo("ok")).toBe("OK")
			await expect(api.echo(1 as unknown as string)).rejects.toThrow("input validation failed")
		} finally {
			controller.dispose()
		}
	})

	test("merges non-array transformed input into the next non-callback arg", async () => {
		const { a, b } = createPair()
		const controller = expose({ echo: async (value: string) => value }, b, {
			plugins: [
				validationPlugin({
					echo: {
						input: z.tuple([z.string()]).transform(([value]) => value.toUpperCase())
					}
				})
			]
		})
		const api = wrap<{ echo(value: string): Promise<string> }>(a)

		try {
			expect(await api.echo("ok")).toBe("OK")
		} finally {
			controller.dispose()
		}
	})

	test("validation errors are detectable by name", async () => {
		const { a, b } = createPair()
		const controller = expose(createApi(), b, {
			plugins: [validationPlugin({ add: { input: z.tuple([z.number(), z.number()]) } })]
		})
		const api = wrap<API>(a)

		try {
			try {
				await api.add("x" as unknown as number, 1)
				throw new Error("expected validation failure")
			} catch (error) {
				expect(error).toBeInstanceOf(Error)
				expect((error as Error).name).toBe("RPCValidationError")
				expect(isRPCValidationError(error)).toBe(true)
				const validationError = error as ValidationErrorShape
				expect(validationError.phase).toBe("input")
				expect(validationError.method).toBe("add")
				expect(Array.isArray(validationError.issues)).toBe(true)
			}
		} finally {
			controller.dispose()
		}
	})
})
