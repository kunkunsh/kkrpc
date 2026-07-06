import { describe, expect, test } from "bun:test"
import { Api } from "./src/backend/api"

describe("tauri-demo backend API", () => {
	test("captures evaluated console output instead of writing to process stdout", async () => {
		const api = new Api()
		const originalLog = console.log
		const originalError = console.error
		const processStdout: unknown[][] = []
		const processStderr: unknown[][] = []

		console.log = (...args: unknown[]) => processStdout.push(args)
		console.error = (...args: unknown[]) => processStderr.push(args)

		try {
			const result = await api.eval(`
console.log("first", 1);
console.error("warning", 2);
`)

			expect(result).toEqual({
				stdout: "first 1\n",
				stderr: "warning 2\n"
			})
			expect(processStdout).toEqual([])
			expect(processStderr).toEqual([])
		} finally {
			console.log = originalLog
			console.error = originalError
		}
	})
})
