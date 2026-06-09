import { parseArgs } from "jsr:@std/cli/parse-args"
import { RPCChannel, stdioJsonTransport } from "kkrpc/deno"
import pkg from "../../packages/kkrpc/package.json" with { type: "json" }

class ReadableStreamLike {
	private listeners = new Set<(chunk: Uint8Array | string) => void>()

	constructor(stream: ReadableStream<Uint8Array>) {
		void this.pump(stream)
	}

	on(event: "data", listener: (chunk: Uint8Array | string) => void): unknown {
		if (event === "data") this.listeners.add(listener)
		return undefined
	}

	off(event: "data", listener: (chunk: Uint8Array | string) => void): this {
		if (event === "data") this.listeners.delete(listener)
		return this
	}

	private async pump(stream: ReadableStream<Uint8Array>): Promise<void> {
		const reader = stream.getReader()
		try {
			while (true) {
				const result = await reader.read()
				if (result.done) return
				for (const listener of this.listeners) listener(result.value)
			}
		} finally {
			reader.releaseLock()
		}
	}
}

const encoder = new TextEncoder()

interface EvalResult {
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

const flags = parseArgs(Deno.args, {
	boolean: ["version"]
})

if (flags.version) {
	console.log(pkg.version)
	Deno.exit(0)
}

const stdio = stdioJsonTransport({
	readable: new ReadableStreamLike(Deno.stdin.readable),
	writable: {
		write(chunk, callback) {
			Deno.stdout.write(encoder.encode(chunk)).then(
				() => callback?.(),
				(error) => callback?.(error instanceof Error ? error : new Error(String(error)))
			)
		}
	}
})
const channel = new RPCChannel(stdio, {
	expose: {
		eval: (code: string) => {
			return captureEvalOutput(() => eval(code))
		}
	}
})

console.error("Deno is running")
