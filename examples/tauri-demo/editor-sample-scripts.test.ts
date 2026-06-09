import { describe, expect, test } from "bun:test"

import { sampleScripts } from "./src/routes/examples/editor/sample-scripts"

describe("editor sample scripts", () => {
	test("avoid stdout lines that look like kkrpc protocol frames", () => {
		expect(sampleScripts.deno).toContain('console.log("Preferences:", JSON.stringify(pref));')
		expect(sampleScripts.bun).toContain('console.log("Users over 20:", JSON.stringify(results));')
	})
})
