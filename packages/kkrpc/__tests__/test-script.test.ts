import { describe, expect, test } from "bun:test"
import { assertBuildSuccess } from "../scripts/test.ts"

describe("package test script", () => {
	test("assertBuildSuccess throws when Bun.build fails", () => {
		expect(() =>
			assertBuildSuccess({
				success: false,
				logs: []
			})
		).toThrow("Failed to build Node test fixture")
	})
})
