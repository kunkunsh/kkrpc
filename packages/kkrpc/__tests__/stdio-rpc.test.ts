import { spawn } from "child_process"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { sleep } from "bun"
import { describe, expect, test } from "bun:test"
import { DenoIo, NodeIo } from "../mod.ts"
import { RPCChannel } from "../src/channel.ts"
import { apiMethods, type API } from "./scripts/api.ts"

function getProjectRoot(): string {
	const fileUrl = new URL(import.meta.url).pathname
	const folderPath = path.dirname(path.dirname(fileUrl))
	return folderPath
}

const projectRoot = getProjectRoot()
const testsPath = path.join(projectRoot, "__tests__")

async function runWorker(worker: ChildProcessWithoutNullStreams) {
	// worker.stderr.pipe(process.stdout);

	// const stdio = createStdio();
	const io = new NodeIo(worker.stdout, worker.stdin)
	const rpc = new RPCChannel<{}, API>(io)
	const api = rpc.getAPI()
	expect(await api.echo("hello")).toEqual("hello")
	expect(await api.add(1, 2)).toEqual(3)
	const sum2 = await new Promise((resolve, reject) => {
		api.addCallback(1, 2, (sum) => {
			resolve(sum)
		})
	})

	expect(sum2).toEqual(3)
	expect(await api.subtract(1, 2)).toEqual(-1)

	// stress test
	for (let i = 0; i < 1000; i++) {
		expect(await api.add(i, i)).toEqual(i + i)
		expect(await api.subtract(i, i)).toEqual(0)
	}
	// stress test with concurrent calls
	await Promise.all(
		Array(5_000)
			.fill(0)
			.map(async (x, idx) => expect(await api.add(idx, idx)).toEqual(idx + idx))
	)
	await Promise.all(
		Array(5_000)
			.fill(0)
			.map(() =>
				api.addCallback(1, 2, (sum) => {
					//   expect(sum).toEqual(3);
				})
			)
	)
	const dummyCallback = (sum: number) => {}
	await Promise.all(
		Array(5_000)
			.fill(0)
			.map(() => api.addCallback(1, 2, dummyCallback))
	)

	/* -------------------------------------------------------------------------- */
	/*                              Nested Object API                             */
	/* -------------------------------------------------------------------------- */
	expect(await api.math.grade1.add(1, 2)).toEqual(3)
	expect(await api.math.grade2.multiply(2, 3)).toEqual(6)

	/* --------------------- Nested Object API with Callback -------------------- */
	expect(await api.math.grade1.add(1, 2, (result) => expect(result).toEqual(3))).toEqual(3)
	expect(await api.math.grade2.multiply(2, 3, (result) => expect(result).toEqual(6))).toEqual(6)

	worker.kill()
}

describe("RPCChannel Test", () => {
	test("DenoStdio", async () => {
		const workerDeno = spawn("deno", [path.join(testsPath, "scripts/deno-api.ts")])
		await runWorker(workerDeno)
	})
	test("NodeStdio", async () => {
		const jsScriptPath = path.join(testsPath, "scripts/node-api.js")
		if (!fs.existsSync(jsScriptPath)) {
			await Bun.build({
				entrypoints: [path.join(testsPath, "scripts/node-api.ts")],
				outdir: path.join(testsPath, "scripts"),
				sourcemap: "inline",
				minify: true
			})
		}
		const workerBun = spawn("node", [jsScriptPath])
		await runWorker(workerBun)
	})
	// test("NodeStdio with bun", async () => {
	// 	const workerBun = spawn("bun", [path.join(testsPath, "scripts/node-api.ts")])
	// 	await runWorker(workerBun)
	// })
})
