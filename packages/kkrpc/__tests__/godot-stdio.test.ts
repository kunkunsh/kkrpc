import { execFile, spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, chmod, readdir, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { describe, expect, test } from "bun:test"
import { dispose, wrap } from "../src/entries/mod.ts"
import { nodeStdioTransport } from "../src/entries/stdio.ts"

interface GodotWorkerAPI {
	add(left: number, right: number): Promise<number>
	callCallback(value: string, callback: (value: string) => void): Promise<void>
}

const packageRoot = resolve(import.meta.dir, "..")

async function findGodotExecutable(directory: string): Promise<string | undefined> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name)
		if (entry.isDirectory()) {
			const executable = await findGodotExecutable(entryPath)
			if (executable) return executable
		} else if (/^godot(?:\.exe|$|.*\.(?:x86_64|arm64|amd64))$/i.test(entry.name)) {
			try {
				await access(entryPath, constants.X_OK)
			} catch {
				if (process.platform === "win32") continue
				await chmod(entryPath, 0o755)
			}
			return entryPath
		}
	}
}

async function getGodotExecutable(): Promise<string> {
	if (process.env.GODOT_BIN) return process.env.GODOT_BIN
	const executable = await findGodotExecutable(join(packageRoot, "godot", ".editor-4.6.1"))
	if (executable) return executable
	throw new Error("GodotJS executable not found. Run pnpm --filter kkrpc prepare:godot-js first.")
}

async function importGodotProject(executable: string): Promise<void> {
	await new Promise<void>((resolveImport, rejectImport) => {
		execFile(
			executable,
			["--headless", "--editor", "--path", join(packageRoot, "godot"), "--quit"],
			(error) => (error ? rejectImport(error) : resolveImport())
		)
	})
}

async function buildGodotFixture(sourceName: string, outputName: string): Promise<string> {
	const output = join(packageRoot, "godot", outputName)
	const result = await Bun.build({
		entrypoints: [join(packageRoot, "godot", sourceName)],
		external: ["godot"],
		format: "cjs",
		minify: true,
		naming: outputName,
		outdir: join(packageRoot, "godot"),
		target: "browser"
	})
	if (!result.success) throw new Error(`Failed to build Godot worker: ${result.logs.join("\n")}`)
	return output
}

describe("GodotJS stdio transport", () => {
	test("supports real bidirectional RPC and exits when the parent closes stdin", async () => {
		const executable = await getGodotExecutable()
		const workerScript = await buildGodotFixture("stdio-worker.fixture.js", "stdio-worker.js")
		await importGodotProject(executable)
		const child = spawn(
			executable,
			["--headless", "--path", join(packageRoot, "godot"), "--script", "res://stdio-worker.js"],
			{ stdio: ["pipe", "pipe", "inherit"] }
		)
		const exit = new Promise<number | null>((resolveExit, rejectExit) => {
			child.once("error", rejectExit)
			child.once("exit", resolveExit)
		})
		const api = wrap<GodotWorkerAPI>(
			nodeStdioTransport({ readable: child.stdout, writable: child.stdin })
		)

		try {
			expect(await api.add(2, 3)).toBe(5)
			expect(await api.add(10, 7)).toBe(17)
			let callbackValue = ""
			await api.callCallback("ready", (value) => (callbackValue = value))
			expect(callbackValue).toBe("godot:ready")
		} finally {
			dispose(api)
		}

		try {
			expect(await exit).toBe(0)
		} finally {
			await rm(workerScript, { force: true })
		}
	}, 60_000)

	test("supports GodotJS as the parent of a stdio child process", async () => {
		const executable = await getGodotExecutable()
		const mainScript = await buildGodotFixture("stdio-main.fixture.js", "stdio-main.js")
		await importGodotProject(executable)
		const child = spawn(
			executable,
			["--headless", "--path", join(packageRoot, "godot"), "--script", "res://stdio-main.js"],
			{
				env: {
					...process.env,
					KKRPC_TEST_BUN: process.execPath,
					KKRPC_TEST_CHILD: join(packageRoot, "godot", "stdio-node-child.fixture.cjs")
				},
				stdio: ["ignore", "inherit", "inherit"]
			}
		)

		try {
			const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
				child.once("error", rejectExit)
				child.once("exit", resolveExit)
			})
			expect(exitCode).toBe(0)
		} finally {
			await rm(mainScript, { force: true })
		}
	}, 60_000)
})
