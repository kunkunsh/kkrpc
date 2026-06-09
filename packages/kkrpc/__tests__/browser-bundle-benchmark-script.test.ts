import { describe, expect, test } from "bun:test"
import {
	createBenchmarkCases,
	formatBytes,
	formatContributorTables,
	formatMeasurementTable,
	getRequiredBundleFailures,
	getTopContributorsFromMetafile,
	type BuildMetafile,
	type BundleMeasurement
} from "../scripts/compare-browser-bundle-size.ts"

const fixtureModule = (...parts: string[]) => parts.join("")

describe("browser bundle benchmark helpers", () => {
	test("formats bytes as KiB with two decimals", () => {
		expect(formatBytes(0)).toBe("0.00 KB")
		expect(formatBytes(1024)).toBe("1.00 KB")
		expect(formatBytes(1536)).toBe("1.50 KB")
	})

	test("formats successful and skipped measurements as a Markdown table", () => {
		const rows: BundleMeasurement[] = [
			{
				name: "kkrpc/browser",
				rawBytes: 2048,
				gzipBytes: 1024,
				brotliBytes: 512,
				moduleCount: 6,
				contributors: []
			},
			{
				name: "kkrpc/worker",
				skipped: "Cannot resolve kkrpc/worker"
			}
		]

		expect(formatMeasurementTable(rows)).toBe(
			[
				"| Bundle | Raw minified | Gzip | Brotli | Modules |",
				"| --- | ---: | ---: | ---: | ---: |",
				"| `kkrpc/browser` | 2.00 KB | 1.00 KB | 0.50 KB | 6 |",
				"| `kkrpc/worker` | skipped | skipped | skipped | skipped |",
				"",
				"Skipped bundles:",
				"- `kkrpc/worker`: Cannot resolve kkrpc/worker"
			].join("\n")
		)
	})

	test("extracts top contributors from Bun metafile outputs", () => {
		const metafile: BuildMetafile = {
			inputs: {
				"src/channel-core.ts": { bytes: 3000 },
				[fixtureModule("src/", "serialization", "-json.ts")]: { bytes: 1000 },
				"entry.ts": { bytes: 200 }
			},
			outputs: {
				"./bundle.js": {
					bytes: 1200,
					inputs: {
						"src/channel-core.ts": { bytesInOutput: 900 },
						[fixtureModule("src/", "serialization", "-json.ts")]: { bytesInOutput: 200 },
						"entry.ts": { bytesInOutput: 50 }
					}
				}
			}
		}

		expect(getTopContributorsFromMetafile(metafile, 2)).toEqual([
			{ module: "src/channel-core.ts", bytes: 900 },
			{ module: fixtureModule("src/", "serialization", "-json.ts"), bytes: 200 }
		])
	})

	test("creates benchmark cases with stable public entries", () => {
		const cases = createBenchmarkCases({
			workDir: "/repo/packages/kkrpc/.browser-bundle-benchmark"
		})

		expect(cases.map((entry) => entry.name)).toEqual([
			"kkrpc",
			"kkrpc/browser",
			"kkrpc/worker",
			"kkrpc/validation",
			"kkrpc/middleware",
			"kkrpc/superjson"
		])
		expect(cases[0]?.source).toContain('from "kkrpc"')
		expect(cases[1]?.source).toContain('from "kkrpc/browser"')
		expect(cases[2]?.source).toContain('from "kkrpc/worker"')
		expect(cases[3]?.source).toContain('from "kkrpc/validation"')
		expect(cases[4]?.source).toContain('from "kkrpc/middleware"')
		expect(cases[5]?.source).toContain('from "kkrpc/superjson"')
		for (const entry of cases) {
			expect(entry.source).toContain("Object.assign(globalThis")
		}
	})

	test("formats contributor tables for measured bundles only", () => {
		const rows: BundleMeasurement[] = [
			{
				name: "kkrpc/browser",
				rawBytes: 1024,
				gzipBytes: 512,
				brotliBytes: 256,
				moduleCount: 2,
				contributors: [
					{ module: "src/channel-core.ts", bytes: 1536 },
					{ module: fixtureModule("src/", "serialization", "-json.ts"), bytes: 512 }
				]
			},
			{
				name: "kkrpc/worker",
				skipped: "Cannot resolve kkrpc/worker"
			}
		]

		expect(formatContributorTables(rows)).toBe(
			[
				"### kkrpc/browser contributors",
				"",
				"| Module | Bytes |",
				"| --- | ---: |",
				"| `src/channel-core.ts` | 1.50 KB |",
				`| \`${fixtureModule("src/", "serialization", "-json.ts")}\` | 0.50 KB |`
			].join("\n")
		)
	})

	test("treats all skipped stable bundles as required failures", () => {
		const rows: BundleMeasurement[] = [
			{ name: "kkrpc/worker", skipped: "Cannot resolve kkrpc/worker" },
			{
				name: "kkrpc/browser",
				rawBytes: 1,
				gzipBytes: 1,
				brotliBytes: 1,
				moduleCount: 1
			}
		]

		expect(getRequiredBundleFailures(rows)).toEqual([
			{ name: "kkrpc/worker", skipped: "Cannot resolve kkrpc/worker" }
		])
	})
})
