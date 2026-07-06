import { afterEach, describe, expect, test } from "bun:test"
import { generateId } from "../src/core/utils.ts"

describe("generateId", () => {
	const originalRandomUUID = globalThis.crypto?.randomUUID

	afterEach(() => {
		if (globalThis.crypto && originalRandomUUID) {
			Object.defineProperty(globalThis.crypto, "randomUUID", {
				configurable: true,
				value: originalRandomUUID
			})
		}
	})

	test("returns unique ids using crypto.randomUUID when available", () => {
		const ids = new Set(Array.from({ length: 1000 }, () => generateId()))
		expect(ids.size).toBe(1000)
	})

	test("stays unique on the fallback path even when clock and random collide", () => {
		// Force the fallback branch by removing crypto.randomUUID.
		Object.defineProperty(globalThis.crypto, "randomUUID", {
			configurable: true,
			value: undefined
		})
		// Pin Date.now and Math.random so only the monotonic counter varies.
		const originalNow = Date.now
		const originalRandom = Math.random
		Date.now = () => 1_700_000_000_000
		Math.random = () => 0.5
		try {
			const ids = new Set(Array.from({ length: 1000 }, () => generateId()))
			expect(ids.size).toBe(1000)
		} finally {
			Date.now = originalNow
			Math.random = originalRandom
		}
	})
})
