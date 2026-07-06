import { describe, expect, test } from "bun:test"
import { RPCChannel } from "kkrpc"
import { stdioJsonTransport } from "kkrpc/stdio"
import { promiseWritable, ReadableStreamLike } from "./src/backend/stream-stdio"

type EvalAPI = {
	eval(code: string): Promise<{ stdout: string; stderr: string }>
}

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

	test("captures evaluated console output without corrupting stdio RPC", async () => {
		const proc = Bun.spawn({
			cmd: ["deno", "run", "-A", "--unstable-kv", "main.ts"],
			cwd: "../deno-backend",
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe"
		})
		const transport = stdioJsonTransport({
			readable: new ReadableStreamLike(proc.stdout),
			writable: promiseWritable((chunk) => proc.stdin.write(chunk))
		})
		const rpc = new RPCChannel<{}, EvalAPI>(transport, { timeout: 1_000 })
		const api = rpc.getAPI()

		try {
			const result = await api.eval(`
console.log("deno stdout", 1);
console.error("deno stderr", 2);
`)

			expect(result).toEqual({
				stdout: "deno stdout 1\n",
				stderr: "deno stderr 2\n"
			})
		} finally {
			rpc.destroy()
			proc.kill()
		}
	})
})
