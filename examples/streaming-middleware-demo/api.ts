/**
 * API definition for the streaming + middleware demo.
 *
 * Streaming patterns:
 *   - countdown   — finite async generator (yields numbers)
 *   - tailLogs    — infinite stream with consumer cancellation
 *   - processTask — progress reporting with structured data
 *
 * Middleware patterns:
 *   - login         — sets per-connection auth session
 *   - getSecretData — protected by auth interceptor
 *   - ping          — public, used to demo rate limiting
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type StreamingMiddlewareAPI = {
	// ─── Public methods ──────────────────────────────────────────────
	ping(): Promise<string>
	countdown(from: number): AsyncIterable<number>
	tailLogs(service: string): AsyncIterable<{ timestamp: string; level: string; message: string }>
	processTask(taskName: string): AsyncIterable<{ percent: number; status: string }>

	// ─── Auth-related methods ────────────────────────────────────────
	login(username: string, password: string): Promise<{ message: string }>
	getSecretData(): Promise<{ classified: string; accessedBy: string }>
}

/**
 * Factory that creates an API instance with per-connection session state.
 *
 * Each WebSocket connection gets its own session object, so the `login()`
 * handler and the auth interceptor can share state via closure scope.
 */
export function createApi(session: { authenticated: boolean; username: string }) {
	const api: StreamingMiddlewareAPI = {
		// ─── Public methods (no auth required) ───────────────────────
		async ping() {
			return "pong"
		},

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
				await sleep(300 + Math.random() * 700)
				const level = levels[Math.floor(Math.random() * levels.length)]!
				const message = messages[Math.floor(Math.random() * messages.length)]!
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
		},

		// ─── Auth-gated methods ──────────────────────────────────────
		async login(username: string, password: string) {
			// Simple demo credentials — in production you'd verify against a database
			if (password === "demo123") {
				session.authenticated = true
				session.username = username
				return { message: `Welcome, ${username}!` }
			}
			throw new Error("Invalid credentials")
		},

		async getSecretData() {
			// Auth interceptor ensures only authenticated users reach here
			return {
				classified: "The answer to life, the universe, and everything is 42.",
				accessedBy: session.username
			}
		}
	}

	return api
}
