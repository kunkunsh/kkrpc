import { $ } from "bun"

type BuildResult = {
	success: boolean
	logs: unknown[]
}

export function assertBuildSuccess(buildOutput: BuildResult): void {
	if (buildOutput.success) return
	for (const log of buildOutput.logs) {
		console.error(log)
	}
	throw new Error("Failed to build Node test fixture")
}

async function main(): Promise<void> {
	// Keep the package test runner from updating deno.lock during Deno regression tests.
	await $`deno test --no-lock -R __deno_tests__`
	const buildOutput = await Bun.build({
		entrypoints: ["__tests__/scripts/node-api.js"],
		outdir: "__tests__/scripts",
		target: "node",
		format: "esm"
	})
	assertBuildSuccess(buildOutput)

	await $`bun test __tests__ --coverage`.env({
		...process.env,
		FORCE_COLOR: "1"
	})
}

if (import.meta.main) {
	await main()
}
