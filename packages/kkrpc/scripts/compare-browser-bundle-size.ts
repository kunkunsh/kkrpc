import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
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
	workDir: string
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
	return rows.filter((row) => row.skipped)
}

export function getTopContributorsFromMetafile(metafile: BuildMetafile, limit = 8): Contributor[] {
	const [output] = Object.values(metafile.outputs)
	if (!output?.inputs) return []

	return Object.entries(output.inputs)
		.map(([module, data]) => ({ module, bytes: data.bytesInOutput ?? 0 }))
		.filter((entry) => entry.bytes > 0)
		.sort((a, b) => b.bytes - a.bytes)
		.slice(0, limit)
}

export function createBenchmarkCases(options: BenchmarkCaseOptions): BenchmarkCase[] {
	const cases: Array<{ name: string; fileName: string; source: string }> = [
		{
			name: "kkrpc",
			fileName: "kkrpc.ts",
			source: createKkrpcCoreSample("kkrpc")
		},
		{
			name: "kkrpc/browser",
			fileName: "kkrpc-browser.ts",
			source: createKkrpcCoreSample("kkrpc/browser")
		},
		{
			name: "kkrpc/worker",
			fileName: "kkrpc-worker.ts",
			source: createKkrpcWorkerSample("kkrpc", "kkrpc/worker")
		},
		{
			name: "kkrpc/validation",
			fileName: "kkrpc-validation.ts",
			source: createKkrpcFeatureSample("kkrpc/validation", "validationPlugin")
		},
		{
			name: "kkrpc/middleware",
			fileName: "kkrpc-middleware.ts",
			source: createKkrpcFeatureSample("kkrpc/middleware", "middlewarePlugin")
		},
		{
			name: "kkrpc/superjson",
			fileName: "kkrpc-superjson.ts",
			source: createKkrpcFeatureSample("kkrpc/superjson", "superJsonCodec")
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

function createKkrpcCoreSample(importPath: string): string {
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

function createKkrpcWorkerSample(coreImport: string, workerImport: string): string {
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

function createKkrpcFeatureSample(importPath: string, exportName: string): string {
	return `import { ${exportName} } from "${importPath}"

export function getFeature() {
	return ${exportName}
}

Object.assign(globalThis, { getFeature })
`
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
	const workDir = join(packageRoot, ".browser-bundle-benchmark")

	await rm(workDir, { recursive: true, force: true })
	await mkdir(workDir, { recursive: true })

	try {
		const cases = createBenchmarkCases({ workDir })
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
