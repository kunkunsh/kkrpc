import { describe, expect, test } from "bun:test"
import {
	createBenchmarkCases,
	formatBytes,
	formatMeasurementTable,
	type BundleMeasurement
} from "./benchmark.ts"

describe("bundle-size benchmark helpers", () => {
	test("creates equal-feature benchmark cases for kkrpc and comctx", () => {
		const cases = createBenchmarkCases("/tmp/bench")

		expect(cases.map((entry) => entry.name)).toEqual([
			"kkrpc core",
			"kkrpc/browser core",
			"kkrpc + json codec",
			"kkrpc + superjson",
			"kkrpc/worker",
			"comctx",
			"comlink"
		])
		for (const entry of cases) {
			expect(entry.source).toContain("add(a: number, b: number): Promise<number>")
			expect(entry.source).toContain("Object.assign(globalThis")
			expect(entry.source).toContain("createAddProxy")
		}
		expect(cases[0]?.source).toContain("expose(localAPI, transport)")
		expect(cases[1]?.source).toContain("expose(localAPI, transport)")
		expect(cases[2]?.source).toContain("expose(localAPI, transport)")
		expect(cases[3]?.source).toContain("expose(localAPI, transport)")
		expect(cases[4]?.source).toContain("expose(localAPI, transport)")
		expect(cases[5]?.source).toContain("exposeMath(adapter)")
		expect(cases[6]?.source).toContain("Comlink.expose(localAPI, endpoint)")
		expect(cases[0]?.source).toContain('from "kkrpc"')
		expect(cases[1]?.source).toContain('from "kkrpc/browser"')
		expect(cases[2]?.source).toContain('from "kkrpc/codecs"')
		expect(cases[3]?.source).toContain('from "kkrpc/superjson"')
		expect(cases[4]?.source).toContain('from "kkrpc/worker"')
		expect(cases[5]?.source).toContain('from "comctx"')
		expect(cases[6]?.source).toContain('from "comlink"')
	})

	test("formats bundle measurements as markdown", () => {
		const rows: BundleMeasurement[] = [
			{
				name: "kkrpc core",
				rawBytes: 2048,
				gzipBytes: 1024,
				brotliBytes: 512,
				moduleCount: 3,
				contributors: []
			},
			{
				name: "comctx",
				skipped: "Cannot resolve comctx"
			}
		]

		expect(formatBytes(1536)).toBe("1.50 KB")
		expect(formatMeasurementTable(rows)).toBe(
			[
				"| Bundle | Raw minified | Gzip | Brotli | Modules |",
				"| --- | ---: | ---: | ---: | ---: |",
				"| `kkrpc core` | 2.00 KB | 1.00 KB | 0.50 KB | 3 |",
				"| `comctx` | skipped | skipped | skipped | skipped |",
				"",
				"Skipped bundles:",
				"- `comctx`: Cannot resolve comctx"
			].join("\n")
		)
	})
})
