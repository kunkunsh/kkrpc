import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	createBenchmarkCases,
	formatBytes,
	formatContributorTables,
	formatMeasurementTable,
	getRequiredBundleFailures,
	getTopContributorsFromMetafile,
	stageLocalComctxSource,
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

	test("creates benchmark cases with public, mini, direct, and comctx entries", () => {
		const cases = createBenchmarkCases({
			packageRoot: "/repo/packages/kkrpc",
			repoRoot: "/repo",
			workDir: "/repo/packages/kkrpc/.browser-bundle-benchmark",
			comctxEntrypoint: "/repo/packages/kkrpc/.browser-bundle-benchmark/comctx-local/index.ts"
		})

		expect(cases.map((entry) => entry.name)).toEqual([
			"kkrpc/browser",
			"kkrpc/browser-lite",
			"kkrpc/browser-mini",
			"kkrpc-lite direct",
			"comctx"
		])
		expect(cases[0]?.source).toContain('from "kkrpc/browser"')
		expect(cases[1]?.source).toContain('from "kkrpc/browser-lite"')
		expect(cases[2]?.source).toContain('from "kkrpc/browser-mini"')
		expect(cases[3]?.source).toContain("src/channel-lite.ts")
		expect(cases[4]?.source).toContain("comctx-local/index.ts")
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
		await writeFile(
			join(sourceRoot, "utils/uuid.ts"),
			"export default function uuid() { return 'id' }\n",
			"utf8"
		)
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

	test("formats contributor tables for measured bundles only", () => {
		const rows: BundleMeasurement[] = [
			{
				name: "kkrpc/browser-lite",
				rawBytes: 1024,
				gzipBytes: 512,
				brotliBytes: 256,
				moduleCount: 2,
				contributors: [
					{ module: "src/channel-core.ts", bytes: 1536 },
					{ module: "src/serialization-json.ts", bytes: 512 }
				]
			},
			{
				name: "comctx",
				skipped: "Cannot resolve comctx"
			}
		]

		expect(formatContributorTables(rows)).toBe(
			[
				"### kkrpc/browser-lite contributors",
				"",
				"| Module | Bytes |",
				"| --- | ---: |",
				"| `src/channel-core.ts` | 1.50 KB |",
				"| `src/serialization-json.ts` | 0.50 KB |"
			].join("\n")
		)
	})

	test("treats skipped kkrpc bundles as required failures", () => {
		const rows: BundleMeasurement[] = [
			{ name: "kkrpc/browser-mini", skipped: "Cannot resolve kkrpc/browser-mini" },
			{ name: "comctx", skipped: "Cannot resolve comctx" },
			{
				name: "kkrpc/browser-lite",
				rawBytes: 1,
				gzipBytes: 1,
				brotliBytes: 1,
				moduleCount: 1
			}
		]

		expect(getRequiredBundleFailures(rows)).toEqual([
			{ name: "kkrpc/browser-mini", skipped: "Cannot resolve kkrpc/browser-mini" }
		])
	})
})
