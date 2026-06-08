import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { brotliCompressSync, gzipSync } from "node:zlib"

export interface Contributor {
	module: string
	bytes: number
}

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

export function getRequiredBundleFailures(rows: BundleMeasurement[]): BundleMeasurement[] {
	return rows.filter((row) => row.skipped && row.name !== "comctx")
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
			name: "kkrpc/next",
			fileName: "kkrpc-next.ts",
			source: createKkrpcNextCoreSample("kkrpc/next")
		},
		{
			name: "kkrpc/next/worker",
			fileName: "kkrpc-next-worker.ts",
			source: createKkrpcNextWorkerSample("kkrpc/next", "kkrpc/next/worker")
		},
		{
			name: "kkrpc/next/validation",
			fileName: "kkrpc-next-validation.ts",
			source: createKkrpcNextFeatureSample("kkrpc/next/validation", "validationPlugin")
		},
		{
			name: "kkrpc/next/middleware",
			fileName: "kkrpc-next-middleware.ts",
			source: createKkrpcNextFeatureSample("kkrpc/next/middleware", "middlewarePlugin")
		},
		{
			name: "kkrpc/next/superjson",
			fileName: "kkrpc-next-superjson.ts",
			source: createKkrpcNextFeatureSample("kkrpc/next/superjson", "superJsonCodec")
		},
		{
			name: "kkrpc/next/classic-compat",
			fileName: "kkrpc-next-classic-compat.ts",
			source: createKkrpcNextFeatureSample("kkrpc/next/classic-compat", "classicPlugins")
		},
		{
			name: "kkrpc/browser-mini",
			fileName: "kkrpc-browser-mini.ts",
			source: createKkrpcPublicSample("kkrpc/browser-mini")
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

function createKkrpcNextCoreSample(importPath: string): string {
	return `import { RPCChannel, type RPCMessage, type Transport } from "${importPath}"

interface RemoteAPI {
	add(a: number, b: number): Promise<number>
}

export function createRPC(transport: Transport<RPCMessage>) {
	const channel = new RPCChannel<object, RemoteAPI>(transport)
	return channel.getAPI()
}

Object.assign(globalThis, { createRPC })
`
}

function createKkrpcNextWorkerSample(coreImport: string, workerImport: string): string {
	return `import { wrap } from "${coreImport}"
import { workerTransport } from "${workerImport}"

interface RemoteAPI {
	add(a: number, b: number): Promise<number>
}

export function createRPC(worker: Worker) {
	return wrap<RemoteAPI>(workerTransport(worker))
}

Object.assign(globalThis, { createRPC })
`
}

function createKkrpcNextFeatureSample(importPath: string, exportName: string): string {
	return `import { ${exportName} } from "${importPath}"

export function getFeature() {
	return ${exportName}
}

Object.assign(globalThis, { getFeature })
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

export async function stageLocalComctxSource(
	sourceRoot: string,
	targetRoot: string
): Promise<string> {
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
		await mkdir(dirname(join(targetRoot, file)), { recursive: true })
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

async function measureCase(
	caseEntry: BenchmarkCase,
	packageRoot: string
): Promise<BundleMeasurement> {
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

		const requiredFailures = getRequiredBundleFailures(rows)
		if (requiredFailures.length > 0) {
			throw new Error(
				[
					"Required browser bundle benchmarks failed:",
					...requiredFailures.map((row) => `- ${row.name}: ${row.skipped}`)
				].join("\n")
			)
		}
	} finally {
		await rm(workDir, { recursive: true, force: true })
	}
}

if (import.meta.main) {
	await main()
}
