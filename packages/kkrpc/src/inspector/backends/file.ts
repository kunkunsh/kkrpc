import type { InspectEvent, InspectorBackend } from "../types.ts"

export interface FileBackendOptions {
	path: string
	bufferSize?: number
	flushIntervalMs?: number
}

interface DenoFileHandle {
	write(data: Uint8Array): Promise<number> | number
	close(): void
}

interface DenoRuntime {
	open(
		path: string,
		options: { write: true; create: true; append: true }
	): Promise<DenoFileHandle>
}

interface BunRuntime {
	openSync(path: string, options: { mode: number; create: true }): unknown
	write(file: unknown, data: Uint8Array): Promise<number> | number
}

type RuntimeGlobals = typeof globalThis & {
	Deno?: DenoRuntime
	Bun?: BunRuntime
}

export class FileBackend implements InspectorBackend {
	private buffer: InspectEvent[] = []
	private flushTimer: ReturnType<typeof setInterval> | null = null
	private encoder = new TextEncoder()

	constructor(private options: FileBackendOptions) {
		const interval = options.flushIntervalMs ?? 1000
		this.flushTimer = setInterval(() => {
			this.flush().catch(console.error)
		}, interval)
	}

	log(event: InspectEvent): void {
		this.buffer.push(event)

		const bufferSize = this.options.bufferSize ?? 100
		if (this.buffer.length >= bufferSize) {
			this.flush().catch(console.error)
		}
	}

	async flush(): Promise<void> {
		if (this.buffer.length === 0) return

		const events = this.buffer
		this.buffer = []

		const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n"
		const data = this.encoder.encode(lines)

		await this.appendFile(data)
	}

	destroy(): void {
		if (this.flushTimer) {
			clearInterval(this.flushTimer)
			this.flushTimer = null
		}
		this.flush().catch(console.error)
	}

	private async appendFile(data: Uint8Array): Promise<void> {
		const runtime = globalThis as RuntimeGlobals

		if (runtime.Deno) {
			const { open } = runtime.Deno
			const file = await open(this.options.path, {
				write: true,
				create: true,
				append: true
			})
			await file.write(data)
			file.close()
		} else if (runtime.Bun) {
			const { write, openSync } = runtime.Bun
			const file = openSync(this.options.path, {
				mode: 0o644,
				create: true
			})
			write(file, data)
		} else {
			const { writeFileSync, existsSync } = await import("node:fs")
			const { appendFile } = await import("node:fs/promises")

			if (!existsSync(this.options.path)) {
				writeFileSync(this.options.path, "")
			}

			await appendFile(this.options.path, data)
		}
	}
}
