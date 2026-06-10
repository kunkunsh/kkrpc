import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { brotliCompressSync, gzipSync } from "node:zlib"

export interface BenchmarkCase {
	name: string
	entryFile: string
	source: string
}

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

interface BuildMetafile {
	inputs: Record<string, unknown>
	outputs: Record<
		string,
		{
			inputs?: Record<string, { bytesInOutput?: number }>
		}
	>
}

export function createBenchmarkCases(workDir: string): BenchmarkCase[] {
	const cases: Array<{ name: string; fileName: string; source: string }> = [
		{
			name: "kkrpc core",
			fileName: "kkrpc-core.ts",
			source: createKkrpcCoreSample("kkrpc")
		},
		{
			name: "kkrpc/browser core",
			fileName: "kkrpc-browser-core.ts",
			source: createKkrpcCoreSample("kkrpc/browser")
		},
		{
			name: "kkrpc + json codec",
			fileName: "kkrpc-json-codec.ts",
			source: createKkrpcCodecSample("kkrpc/codecs", "jsonCodec")
		},
		{
			name: "kkrpc + superjson",
			fileName: "kkrpc-superjson.ts",
			source: createKkrpcCodecSample("kkrpc/superjson", "superJsonCodec")
		},
		{
			name: "kkrpc/worker",
			fileName: "kkrpc-worker.ts",
			source: createKkrpcWorkerSample()
		},
		{
			name: "comctx",
			fileName: "comctx.ts",
			source: createComctxSample()
		}
	]

	return cases.map((entry) => ({
		name: entry.name,
		entryFile: join(workDir, entry.fileName),
		source: entry.source
	}))
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

export async function runBenchmark(workDir = join(import.meta.dir, "..", ".bundle-size")) {
	await rm(workDir, { recursive: true, force: true })
	await mkdir(workDir, { recursive: true })

	try {
		const rows: BundleMeasurement[] = []
		for (const benchmarkCase of createBenchmarkCases(workDir)) {
			rows.push(await measureCase(benchmarkCase))
		}

		return [formatMeasurementTable(rows), formatContributorTables(rows)]
			.filter(Boolean)
			.join("\n\n")
	} finally {
		await rm(workDir, { recursive: true, force: true })
	}
}

function createKkrpcCoreSample(importPath: string): string {
	return `import { expose, wrap, type RPCMessage, type Transport } from "${importPath}"

interface RemoteAPI {
	add(a: number, b: number): Promise<number>
}

const localAPI: RemoteAPI = {
	async add(a, b) {
		return a + b
	}
}

export function createAddProxy(transport: Transport<RPCMessage>) {
	expose(localAPI, transport)
	const api = wrap<RemoteAPI>(transport)
	return () => api.add(1, 2)
}

Object.assign(globalThis, { createAddProxy })
`
}

function createKkrpcCodecSample(codecImport: string, codecName: string): string {
	return `import { expose, wrap, type RPCMessage } from "kkrpc"
import { createTransport, type Platform } from "kkrpc/transport"
import { ${codecName} } from "${codecImport}"

interface RemoteAPI {
	add(a: number, b: number): Promise<number>
}

const localAPI: RemoteAPI = {
	async add(a, b) {
		return a + b
	}
}

export function createAddProxy(platform: Platform<string>) {
	const transport = createTransport<RPCMessage, string>({
		platform,
		codec: ${codecName}<RPCMessage>()
	})
	expose(localAPI, transport)
	const api = wrap<RemoteAPI>(transport)
	return () => api.add(1, 2)
}

Object.assign(globalThis, { createAddProxy })
`
}

function createKkrpcWorkerSample(): string {
	return `import { expose, wrap, type RPCMessage, type Transport } from "kkrpc"
import { workerTransport } from "kkrpc/worker"

interface RemoteAPI {
	add(a: number, b: number): Promise<number>
}

const localAPI: RemoteAPI = {
	async add(a, b) {
		return a + b
	}
}

export function createAddProxy(worker: Worker) {
	const transport = workerTransport(worker) as Transport<RPCMessage>
	expose(localAPI, transport)
	const api = wrap<RemoteAPI>(transport)
	return () => api.add(1, 2)
}

Object.assign(globalThis, { createAddProxy })
`
}

function createComctxSample(): string {
	return `import { defineProxy, type Adapter } from "comctx"

interface RemoteAPI {
	add(a: number, b: number): Promise<number>
}

const [exposeMath, injectMath] = defineProxy(() => ({
	add: async (a: number, b: number) => a + b
}))

export function createAddProxy(adapter: Adapter) {
	exposeMath(adapter)
	const api = injectMath(adapter) as RemoteAPI
	return () => api.add(1, 2)
}

Object.assign(globalThis, { createAddProxy })
`
}

async function measureCase(benchmarkCase: BenchmarkCase): Promise<BundleMeasurement> {
	try {
		await Bun.write(benchmarkCase.entryFile, benchmarkCase.source)
		const result = await Bun.build({
			entrypoints: [benchmarkCase.entryFile],
			target: "browser",
			minify: true,
			metafile: true
		})

		if (!result.success) {
			throw new Error(result.logs.map((log) => log.message).join("\n"))
		}

		const output =
			result.outputs.find((artifact) => artifact.kind === "entry-point") ?? result.outputs[0]
		if (!output) throw new Error("Bun.build did not produce an output artifact")

		const bytes = await output.arrayBuffer()
		const buffer = Buffer.from(bytes)
		const metafile = result.metafile as BuildMetafile | undefined

		return {
			name: benchmarkCase.name,
			rawBytes: buffer.byteLength,
			gzipBytes: gzipSync(buffer, { level: 9 }).byteLength,
			brotliBytes: brotliCompressSync(buffer).byteLength,
			moduleCount: metafile ? Object.keys(metafile.inputs).length : undefined,
			contributors: metafile ? getTopContributorsFromMetafile(metafile) : []
		}
	} catch (error) {
		return {
			name: benchmarkCase.name,
			skipped: error instanceof Error ? error.message : String(error)
		}
	}
}

function getTopContributorsFromMetafile(metafile: BuildMetafile, limit = 8): Contributor[] {
	const [output] = Object.values(metafile.outputs)
	if (!output?.inputs) return []

	return Object.entries(output.inputs)
		.map(([module, data]) => ({ module, bytes: data.bytesInOutput ?? 0 }))
		.filter((entry) => entry.bytes > 0)
		.sort((a, b) => b.bytes - a.bytes)
		.slice(0, limit)
}

if (import.meta.main) {
	console.log(await runBenchmark())
}
