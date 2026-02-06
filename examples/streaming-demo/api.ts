/**
 * Streaming API definition.
 *
 * Demonstrates three practical streaming patterns:
 *
 * 1. **Countdown timer** — finite stream that yields values at intervals,
 *    showing the simplest async generator pattern.
 *
 * 2. **Log tail** — simulates `tail -f` on a log file. Produces entries
 *    indefinitely until the consumer breaks. Shows how infinite streams
 *    work with consumer cancellation.
 *
 * 3. **Progress tracker** — simulates a long-running task that reports
 *    progress percentage. Shows how streaming replaces callback-based
 *    progress reporting with a cleaner for-await pattern.
 *
 * Plus a regular (non-streaming) method to demonstrate coexistence.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type StreamingAPI = {
	/** Regular request/response method — works alongside streaming. */
	ping(): Promise<string>

	/** Finite stream: counts down from `from` to 0, one per second. */
	countdown(from: number): AsyncIterable<number>

	/** Infinite stream: simulates log entries arriving every 500ms. */
	tailLogs(service: string): AsyncIterable<{ timestamp: string; level: string; message: string }>

	/** Finite stream: simulates a task and reports progress 0–100%. */
	processTask(taskName: string): AsyncIterable<{ percent: number; status: string }>
}

export const streamingApi: StreamingAPI = {
	ping: async () => "pong",

	async *countdown(from: number) {
		for (let i = from; i >= 0; i--) {
			yield i
			if (i > 0) await sleep(1000)
		}
	},

	async *tailLogs(service: string) {
		const levels = ["INFO", "DEBUG", "WARN", "ERROR"]
		const messages = [
			"Request received",
			"Processing payload",
			"Cache hit",
			"Cache miss — fetching from DB",
			"Response sent",
			"Connection closed",
			"Health check passed",
			"Retry attempt"
		]
		let seq = 0
		while (true) {
			await sleep(300 + Math.random() * 700) // 300–1000ms jitter
			const level = levels[Math.floor(Math.random() * levels.length)]
			const message = messages[Math.floor(Math.random() * messages.length)]
			yield {
				timestamp: new Date().toISOString(),
				level,
				message: `[${service}#${seq++}] ${message}`
			}
		}
	},

	async *processTask(taskName: string) {
		const steps = [
			{ at: 0, status: "Initializing" },
			{ at: 15, status: "Loading data" },
			{ at: 35, status: "Validating schema" },
			{ at: 50, status: "Transforming records" },
			{ at: 70, status: "Writing output" },
			{ at: 85, status: "Running checks" },
			{ at: 100, status: "Complete" }
		]

		for (const step of steps) {
			await sleep(200 + Math.random() * 300)
			yield { percent: step.at, status: `${taskName}: ${step.status}` }
		}
	}
}
