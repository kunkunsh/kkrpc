# Browser Bundle Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible Bun bundle-size benchmark comparing `kkrpc/browser`, `kkrpc/browser-lite`, a direct lite diagnostic import, and `comctx`.

**Architecture:** Add one executable TypeScript script under `packages/kkrpc/scripts/` that generates temporary sample programs, runs `bun build --target=browser --minify` with metafiles, measures raw/gzip/brotli sizes, and prints Markdown tables. Keep runtime code unchanged; this is an observational benchmark only.

**Tech Stack:** TypeScript, Bun test runner, Bun CLI bundler, Node `zlib`, pnpm workspace scripts, kkrpc package self-reference exports, local `references/comctx` source fallback.

---

## Commit Policy

Do not commit during implementation unless the user explicitly requests it. Leave changes unstaged for review after verification.

## File Structure

Create or modify these files:

- Create: `packages/kkrpc/scripts/compare-browser-bundle-size.ts`
- Create: `packages/kkrpc/__tests__/browser-bundle-benchmark-script.test.ts`
- Modify: `packages/kkrpc/package.json`

Boundary decisions:

- `compare-browser-bundle-size.ts` owns benchmark source generation, local comctx staging, Bun CLI execution, size measurement, metafile parsing, and Markdown output.
- `browser-bundle-benchmark-script.test.ts` tests pure helper behavior and local comctx staging so the script can be imported safely without running the benchmark.
- `package.json` only adds an observational script. It does not add CI thresholds.

### Task 1: Add Formatting And Metafile Helper Tests

**Files:**
- Create: `packages/kkrpc/__tests__/browser-bundle-benchmark-script.test.ts`
- Create: `packages/kkrpc/scripts/compare-browser-bundle-size.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `packages/kkrpc/__tests__/browser-bundle-benchmark-script.test.ts` with this content:

```ts
import { describe, expect, test } from "bun:test"
import {
	formatBytes,
	formatMeasurementTable,
	getTopContributorsFromMetafile,
	type BuildMetafile,
	type BundleMeasurement
} from "../scripts/compare-browser-bundle-size.ts"

describe("browser bundle benchmark helpers", () => {
	test("formats bytes as KiB with two decimals", () => {
		expect(formatBytes(0)).toBe("0.00 KB")
		expect(formatBytes(1024)).toBe("1.00 KB")
		expect(formatBytes(1536)).toBe("1.50 KB")
	})

	test("formats successful and skipped measurements as a Markdown table", () => {
		const rows: BundleMeasurement[] = [
			{
				name: "kkrpc/browser-lite",
				rawBytes: 2048,
				gzipBytes: 1024,
				brotliBytes: 512,
				moduleCount: 6,
				contributors: []
			},
			{
				name: "comctx",
				skipped: "Cannot resolve comctx"
			}
		]

		expect(formatMeasurementTable(rows)).toBe(
			[
				"| Bundle | Raw minified | Gzip | Brotli | Modules |",
				"| --- | ---: | ---: | ---: | ---: |",
				"| `kkrpc/browser-lite` | 2.00 KB | 1.00 KB | 0.50 KB | 6 |",
				"| `comctx` | skipped | skipped | skipped | skipped |",
				"",
				"Skipped bundles:",
				"- `comctx`: Cannot resolve comctx"
			].join("\n")
		)
	})

	test("extracts top contributors from Bun metafile outputs", () => {
		const metafile: BuildMetafile = {
			inputs: {
				"src/channel-core.ts": { bytes: 3000 },
				"src/serialization-json.ts": { bytes: 1000 },
				"entry.ts": { bytes: 200 }
			},
			outputs: {
				"./bundle.js": {
					bytes: 1200,
					inputs: {
						"src/channel-core.ts": { bytesInOutput: 900 },
						"src/serialization-json.ts": { bytesInOutput: 200 },
						"entry.ts": { bytesInOutput: 50 }
					}
				}
			}
		}

		expect(getTopContributorsFromMetafile(metafile, 2)).toEqual([
			{ module: "src/channel-core.ts", bytes: 900 },
			{ module: "src/serialization-json.ts", bytes: 200 }
		])
	})
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter kkrpc test -- __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: FAIL because `packages/kkrpc/scripts/compare-browser-bundle-size.ts` does not exist.

- [ ] **Step 3: Add minimal helper implementation**

Create `packages/kkrpc/scripts/compare-browser-bundle-size.ts` with this initial content:

```ts
export interface Contributor {
	module: string
	bytes: number
}

export interface BundleMeasurement {
	name: string
	rawBytes?: number
	gzipBytes?: number
	brotliBytes?: number
	moduleCount?: number
	contributors?: Contributor[]
	skipped?: string
}

export interface BuildMetafile {
	inputs: Record<string, { bytes?: number }>
	outputs: Record<
		string,
		{
			bytes?: number
			inputs?: Record<string, { bytesInOutput?: number }>
		}
	>
}

export function formatBytes(bytes: number): string {
	return `${(bytes / 1024).toFixed(2)} KB`
}

export function formatMeasurementTable(rows: BundleMeasurement[]): string {
	const lines = [
		"| Bundle | Raw minified | Gzip | Brotli | Modules |",
		"| --- | ---: | ---: | ---: | ---: |"
	]

	for (const row of rows) {
		if (row.skipped) {
			lines.push(`| \`${row.name}\` | skipped | skipped | skipped | skipped |`)
			continue
		}

		lines.push(
			`| \`${row.name}\` | ${formatBytes(row.rawBytes ?? 0)} | ${formatBytes(row.gzipBytes ?? 0)} | ${formatBytes(row.brotliBytes ?? 0)} | ${row.moduleCount ?? 0} |`
		)
	}

	const skippedRows = rows.filter((row) => row.skipped)
	if (skippedRows.length > 0) {
		lines.push("", "Skipped bundles:")
		for (const row of skippedRows) {
			lines.push(`- \`${row.name}\`: ${row.skipped}`)
		}
	}

	return lines.join("\n")
}

export function getTopContributorsFromMetafile(
	metafile: BuildMetafile,
	limit = 8
): Contributor[] {
	const [output] = Object.values(metafile.outputs)
	if (!output?.inputs) return []

	return Object.entries(output.inputs)
		.map(([module, data]) => ({ module, bytes: data.bytesInOutput ?? 0 }))
		.filter((entry) => entry.bytes > 0)
		.sort((a, b) => b.bytes - a.bytes)
		.slice(0, limit)
}
```

- [ ] **Step 4: Run the helper test and verify it passes**

Run:

```bash
pnpm --filter kkrpc test -- __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: PASS for the three helper tests.

### Task 2: Add Sample Generation And Local comctx Staging

**Files:**
- Modify: `packages/kkrpc/__tests__/browser-bundle-benchmark-script.test.ts`
- Modify: `packages/kkrpc/scripts/compare-browser-bundle-size.ts`

- [ ] **Step 1: Extend tests for generated cases and local comctx staging**

Append these tests inside the existing `describe` block in `packages/kkrpc/__tests__/browser-bundle-benchmark-script.test.ts`:

```ts
	test("creates benchmark cases with public, direct, and comctx entries", () => {
		const cases = createBenchmarkCases({
			packageRoot: "/repo/packages/kkrpc",
			repoRoot: "/repo",
			workDir: "/repo/packages/kkrpc/.browser-bundle-benchmark",
			comctxEntrypoint: "/repo/packages/kkrpc/.browser-bundle-benchmark/comctx-local/index.ts"
		})

		expect(cases.map((entry) => entry.name)).toEqual([
			"kkrpc/browser",
			"kkrpc/browser-lite",
			"kkrpc-lite direct",
			"comctx"
		])
		expect(cases[0]?.source).toContain('from "kkrpc/browser"')
		expect(cases[1]?.source).toContain('from "kkrpc/browser-lite"')
		expect(cases[2]?.source).toContain("src/channel-lite.ts")
		expect(cases[3]?.source).toContain("comctx-local/index.ts")
		for (const entry of cases) {
			expect(entry.source).toContain("Object.assign(globalThis")
		}
	})

	test("stages local comctx source with rewritten alias imports", async () => {
		const sourceRoot = await mkdtemp(join(tmpdir(), "comctx-source-"))
		const targetRoot = await mkdtemp(join(tmpdir(), "comctx-target-"))

		await mkdir(join(sourceRoot, "utils"), { recursive: true })
		await writeFile(join(sourceRoot, "index.ts"), "export * from './comctx'\n", "utf8")
		await writeFile(
			join(sourceRoot, "comctx.ts"),
			[
				"import uuid from '@/utils/uuid'",
				"import setIntervalImmediate from '@/utils/setIntervalImmediate'",
				"import extractTransfer from '@/utils/extractTransfer'",
				"export const value = [uuid, setIntervalImmediate, extractTransfer]"
			].join("\n"),
			"utf8"
		)
		await writeFile(join(sourceRoot, "protocol.ts"), "export const protocol = true\n", "utf8")
		await writeFile(join(sourceRoot, "utils/uuid.ts"), "export default function uuid() { return 'id' }\n", "utf8")
		await writeFile(
			join(sourceRoot, "utils/setIntervalImmediate.ts"),
			"export default function setIntervalImmediate() { return () => {} }\n",
			"utf8"
		)
		await writeFile(
			join(sourceRoot, "utils/extractTransfer.ts"),
			"export default function extractTransfer() { return [] }\n",
			"utf8"
		)
		await writeFile(
			join(sourceRoot, "utils/safeInstanceOf.ts"),
			"export default function safeInstanceOf() { return false }\n",
			"utf8"
		)

		const entrypoint = await stageLocalComctxSource(sourceRoot, targetRoot)
		const stagedComctx = await readFile(join(targetRoot, "comctx.ts"), "utf8")

		expect(entrypoint).toBe(join(targetRoot, "index.ts"))
		expect(stagedComctx).toContain('from "./utils/uuid.ts"')
		expect(stagedComctx).toContain('from "./utils/setIntervalImmediate.ts"')
		expect(stagedComctx).toContain('from "./utils/extractTransfer.ts"')
	})
```

Add these imports at the top of the test file:

```ts
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createBenchmarkCases, stageLocalComctxSource } from "../scripts/compare-browser-bundle-size.ts"
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter kkrpc test -- __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: FAIL because `createBenchmarkCases` and `stageLocalComctxSource` are not implemented.

- [ ] **Step 3: Implement generated cases and local comctx staging**

Extend `packages/kkrpc/scripts/compare-browser-bundle-size.ts` with these exports:

```ts
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { basename, join, relative } from "node:path"

export interface BenchmarkCase {
	name: string
	entryFile: string
	outfile: string
	metafile: string
	source: string
}

export interface BenchmarkCaseOptions {
	packageRoot: string
	repoRoot: string
	workDir: string
	comctxEntrypoint: string
}

function toImportPath(path: string): string {
	return path.replaceAll("\\", "/")
}

export function createBenchmarkCases(options: BenchmarkCaseOptions): BenchmarkCase[] {
	const directChannelImport = toImportPath(join(options.packageRoot, "src/channel-lite.ts"))
	const directInterfaceImport = toImportPath(join(options.packageRoot, "src/interface.ts"))
	const comctxImport = toImportPath(options.comctxEntrypoint)

	const cases: Array<{ name: string; fileName: string; source: string }> = [
		{
			name: "kkrpc/browser",
			fileName: "kkrpc-browser.ts",
			source: createKkrpcPublicSample("kkrpc/browser")
		},
		{
			name: "kkrpc/browser-lite",
			fileName: "kkrpc-browser-lite.ts",
			source: createKkrpcPublicSample("kkrpc/browser-lite")
		},
		{
			name: "kkrpc-lite direct",
			fileName: "kkrpc-lite-direct.ts",
			source: createKkrpcDirectSample(directChannelImport, directInterfaceImport)
		},
		{
			name: "comctx",
			fileName: "comctx.ts",
			source: createComctxSample(comctxImport)
		}
	]

	return cases.map((entry) => ({
		name: entry.name,
		entryFile: join(options.workDir, entry.fileName),
		outfile: join(options.workDir, `${entry.fileName.replace(/\.ts$/, "")}.js`),
		metafile: join(options.workDir, `${entry.fileName.replace(/\.ts$/, "")}.json`),
		source: entry.source
	}))
}

function createKkrpcPublicSample(importPath: string): string {
	return `import { RPCChannel, WorkerParentIO } from "${importPath}"

interface RemoteAPI {
	add(a: number, b: number): Promise<number>
}

export function createRPC(worker: Worker) {
	const channel = new RPCChannel<{}, RemoteAPI>(new WorkerParentIO(worker))
	return channel.getAPI()
}

Object.assign(globalThis, { createRPC })
`
}

function createKkrpcDirectSample(channelImport: string, interfaceImport: string): string {
	return `import { RPCChannel } from "${channelImport}"
import type { IoInterface, IoMessage } from "${interfaceImport}"

interface RemoteAPI {
	add(a: number, b: number): Promise<number>
}

class TinyWorkerIO implements IoInterface {
	name = "tiny-worker-io"
	capabilities = { structuredClone: true, transfer: true }
	private queue: Array<string | IoMessage> = []
	private resolveRead: ((value: string | IoMessage | null) => void) | null = null

	constructor(private worker: Worker) {
		this.worker.onmessage = (event) => {
			const value = event.data && typeof event.data === "object" && "version" in event.data
				? { data: event.data, transfers: event.data.__transferredValues ?? [] }
				: event.data
			if (this.resolveRead) {
				this.resolveRead(value)
				this.resolveRead = null
				return
			}
			this.queue.push(value)
		}
	}

	read(): Promise<string | IoMessage | null> {
		if (this.queue.length > 0) return Promise.resolve(this.queue.shift() ?? null)
		return new Promise((resolve) => { this.resolveRead = resolve })
	}

	write(message: string | IoMessage): Promise<void> {
		if (typeof message === "string") this.worker.postMessage(message)
		else if (message.transfers?.length) this.worker.postMessage(message.data, message.transfers as Transferable[])
		else this.worker.postMessage(message.data)
		return Promise.resolve()
	}

	on(_event: "message" | "error", _listener: Function): void {}
	off(_event: "message" | "error", _listener: Function): void {}
}

export function createRPC(worker: Worker) {
	const channel = new RPCChannel<{}, RemoteAPI>(new TinyWorkerIO(worker))
	return channel.getAPI()
}

Object.assign(globalThis, { createRPC })
`
}

function createComctxSample(comctxImport: string): string {
	return `import { defineProxy, type Adapter } from "${comctxImport}"

interface RemoteAPI {
	add(a: number, b: number): Promise<number>
}

const [, injectMath] = defineProxy(() => ({
	add: async (a: number, b: number) => a + b
}))

export function createRPC(adapter: Adapter) {
	return injectMath(adapter) as RemoteAPI
}

Object.assign(globalThis, { createRPC })
`
}

export async function stageLocalComctxSource(sourceRoot: string, targetRoot: string): Promise<string> {
	await rm(targetRoot, { recursive: true, force: true })
	await mkdir(join(targetRoot, "utils"), { recursive: true })

	const files = [
		"index.ts",
		"comctx.ts",
		"protocol.ts",
		"utils/uuid.ts",
		"utils/setIntervalImmediate.ts",
		"utils/extractTransfer.ts",
		"utils/safeInstanceOf.ts"
	]

	for (const file of files) {
		const source = await readFile(join(sourceRoot, file), "utf8")
		const rewritten = file === "comctx.ts" ? rewriteComctxAliases(source) : source
		await mkdir(join(targetRoot, file, ".."), { recursive: true })
		await writeFile(join(targetRoot, file), rewritten, "utf8")
	}

	return join(targetRoot, "index.ts")
}

function rewriteComctxAliases(source: string): string {
	return source
		.replaceAll("'@/utils/uuid'", '"./utils/uuid.ts"')
		.replaceAll("'@/utils/setIntervalImmediate'", '"./utils/setIntervalImmediate.ts"')
		.replaceAll("'@/utils/extractTransfer'", '"./utils/extractTransfer.ts"')
		.replaceAll('"@/utils/uuid"', '"./utils/uuid.ts"')
		.replaceAll('"@/utils/setIntervalImmediate"', '"./utils/setIntervalImmediate.ts"')
		.replaceAll('"@/utils/extractTransfer"', '"./utils/extractTransfer.ts"')
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter kkrpc test -- __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: PASS for helper, case generation, and comctx staging tests.

### Task 3: Add Executable Benchmark Runner

**Files:**
- Modify: `packages/kkrpc/scripts/compare-browser-bundle-size.ts`
- Modify: `packages/kkrpc/package.json`

- [ ] **Step 1: Add package script**

Modify `packages/kkrpc/package.json` scripts to include:

```json
"compare:browser-bundle-size": "pnpm build && bun run scripts/compare-browser-bundle-size.ts"
```

- [ ] **Step 2: Implement the runner**

Extend `packages/kkrpc/scripts/compare-browser-bundle-size.ts` with executable code that:

- Computes `packageRoot = join(import.meta.dir, "..")` and `repoRoot = join(packageRoot, "..", "..")`.
- Uses `workDir = join(packageRoot, ".browser-bundle-benchmark")` so `kkrpc/browser` self-references resolve through `packages/kkrpc/package.json` exports.
- Stages local comctx from `join(repoRoot, "references/comctx/core/src")` to `join(workDir, "comctx-local")`.
- Writes all generated sample files under `workDir`.
- Runs Bun CLI with `--target=browser`, `--minify`, `--outfile`, and `--metafile`.
- Reads the output file and metafile for each successful case.
- Prints the measurement table and top contributors.
- Removes `workDir` in a `finally` block.

Add these functions and main guard:

```ts
import { brotliCompressSync, gzipSync } from "node:zlib"
import { existsSync } from "node:fs"

async function runBuild(caseEntry: BenchmarkCase, packageRoot: string): Promise<void> {
	const proc = Bun.spawn(
		[
			"bun",
			"build",
			caseEntry.entryFile,
			"--target=browser",
			"--minify",
			`--outfile=${caseEntry.outfile}`,
			`--metafile=${caseEntry.metafile}`
		],
		{
			cwd: packageRoot,
			stdout: "pipe",
			stderr: "pipe"
		}
	)

	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	])

	if (exitCode !== 0) {
		throw new Error([stdout.trim(), stderr.trim()].filter(Boolean).join("\n"))
	}
}

async function measureCase(caseEntry: BenchmarkCase, packageRoot: string): Promise<BundleMeasurement> {
	try {
		await writeFile(caseEntry.entryFile, caseEntry.source, "utf8")
		await runBuild(caseEntry, packageRoot)

		const output = await readFile(caseEntry.outfile)
		const metafile = JSON.parse(await readFile(caseEntry.metafile, "utf8")) as BuildMetafile

		return {
			name: caseEntry.name,
			rawBytes: output.byteLength,
			gzipBytes: gzipSync(output, { level: 9 }).byteLength,
			brotliBytes: brotliCompressSync(output).byteLength,
			moduleCount: Object.keys(metafile.inputs).length,
			contributors: getTopContributorsFromMetafile(metafile)
		}
	} catch (error) {
		return {
			name: caseEntry.name,
			skipped: error instanceof Error ? error.message : String(error)
		}
	}
}

export function formatContributorTables(rows: BundleMeasurement[]): string {
	const sections: string[] = []
	for (const row of rows) {
		if (row.skipped || !row.contributors || row.contributors.length === 0) continue
		sections.push(`### ${row.name} contributors`)
		sections.push("", "| Module | Bytes |", "| --- | ---: |")
		for (const contributor of row.contributors) {
			sections.push(`| \`${contributor.module}\` | ${formatBytes(contributor.bytes)} |`)
		}
		sections.push("")
	}
	return sections.join("\n").trimEnd()
}

async function main(): Promise<void> {
	const packageRoot = join(import.meta.dir, "..")
	const repoRoot = join(packageRoot, "..", "..")
	const workDir = join(packageRoot, ".browser-bundle-benchmark")
	const localComctxSource = join(repoRoot, "references/comctx/core/src")
	const localComctxTarget = join(workDir, "comctx-local")

	await rm(workDir, { recursive: true, force: true })
	await mkdir(workDir, { recursive: true })

	try {
		const comctxEntrypoint = existsSync(localComctxSource)
			? await stageLocalComctxSource(localComctxSource, localComctxTarget)
			: "comctx"
		const cases = createBenchmarkCases({ packageRoot, repoRoot, workDir, comctxEntrypoint })
		const rows: BundleMeasurement[] = []

		for (const caseEntry of cases) {
			rows.push(await measureCase(caseEntry, packageRoot))
		}

		console.log(formatMeasurementTable(rows))
		const contributors = formatContributorTables(rows)
		if (contributors.length > 0) {
			console.log("\n" + contributors)
		}
	} finally {
		await rm(workDir, { recursive: true, force: true })
	}
}

if (import.meta.main) {
	await main()
}
```

- [ ] **Step 3: Run typecheck and focused script test**

Run:

```bash
pnpm --filter kkrpc check-types
pnpm --filter kkrpc test -- __tests__/browser-bundle-benchmark-script.test.ts
```

Expected: both commands pass.

### Task 4: Verify Bundle Benchmark End-To-End

**Files:**
- No new files. Verify generated output only.

- [ ] **Step 1: Run the new benchmark script**

Run:

```bash
pnpm --filter kkrpc compare:browser-bundle-size
```

Expected: command exits 0 and prints a Markdown table with rows for `kkrpc/browser`, `kkrpc/browser-lite`, `kkrpc-lite direct`, and `comctx`. The `comctx` row should be measured from `references/comctx` in this repo, not skipped.

- [ ] **Step 2: Run the existing lite import-graph guard**

Run:

```bash
pnpm --filter kkrpc check:browser-lite-bundle
```

Expected: command exits 0 and prints `[browser-lite-bundle] No forbidden SuperJSON dependency imports found`.

- [ ] **Step 3: Inspect changed files**

Run:

```bash
git status --short
git diff -- packages/kkrpc/scripts/compare-browser-bundle-size.ts packages/kkrpc/__tests__/browser-bundle-benchmark-script.test.ts packages/kkrpc/package.json docs/superpowers/specs/2026-06-06-browser-bundle-benchmark-design.md docs/superpowers/plans/2026-06-06-browser-bundle-benchmark.md
```

Expected: only the intended benchmark script, test, package script, spec, and plan changes appear. Do not revert unrelated existing changes.

## Self-Review Notes

Spec coverage:

- Sample programs are generated by Task 2.
- Bun bundle size comparison is implemented by Task 3.
- comctx comparison is implemented by Task 2 staging plus Task 3 runner.
- Current kkrpc runtime features are untouched by all tasks.

Placeholder scan:

- No deferred implementation items are left in this plan.

Type consistency:

- `BundleMeasurement`, `BuildMetafile`, `BenchmarkCase`, and `Contributor` are defined before later tasks consume them.
