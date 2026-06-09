export interface EvalResult {
	stdout: string
	stderr: string
}

function formatConsoleArg(value: unknown): string {
	if (typeof value === "string") return value
	if (value instanceof Error) return value.stack ?? value.message
	if (typeof value === "object" && value !== null) {
		try {
			return JSON.stringify(value) ?? String(value)
		} catch {
			return String(value)
		}
	}
	return String(value)
}

function formatConsoleLine(args: unknown[]): string {
	return `${args.map(formatConsoleArg).join(" ")}\n`
}

async function captureEvalOutput(run: () => unknown): Promise<EvalResult> {
	let stdout = ""
	let stderr = ""
	const originalLog = console.log
	const originalError = console.error

	console.log = (...args: unknown[]) => {
		stdout += formatConsoleLine(args)
	}
	console.error = (...args: unknown[]) => {
		stderr += formatConsoleLine(args)
	}

	try {
		await run()
		return { stdout, stderr }
	} finally {
		console.log = originalLog
		console.error = originalError
	}
}

export class Api {
	async eval(code: string): Promise<EvalResult> {
		return captureEvalOutput(async () => {
			if (process.versions.bun) {
				// Use dynamic import with base64 data URL to support ES modules in Bun.
				const base64 = Buffer.from(code).toString("base64")
				const dataUrl = `data:text/javascript;base64,${base64}`
				await import(dataUrl)
				return
			}
			await eval(code) // This only works with deno and node, not bun.
		})
	}
}

export const api = new Api()
