import { describe, expect, test } from "bun:test"

describe("tauri-demo Deno sidecar", () => {
	test("starts as an RPC server without calling the frontend API", async () => {
		const proc = Bun.spawn({
			cmd: ["deno", "run", "-A", "--unstable-kv", "main.ts"],
			cwd: "../deno-backend",
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe"
		})

		await new Promise((resolve) => setTimeout(resolve, 500))
		proc.kill()

		const stdout = await new Response(proc.stdout).text()
		const stderr = await new Response(proc.stderr).text()

		expect(stdout).toBe("")
		expect(stderr).toContain("Deno is running")
	})
})
