/**
 * API definition for the middleware demo.
 *
 * Stable kkrpc supports request/response, callback arguments, and remote async
 * iterables. This demo shows all three shapes for multi-step work.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface LogEntry {
	timestamp: string
	level: string
	message: string
}

export interface TaskProgress {
	percent: number
	status: string
}

export type MiddlewareDemoAPI = {
	ping(): Promise<string>
	countdown(from: number): Promise<number[]>
	getLogs(service: string, count: number): Promise<LogEntry[]>
	processTask(taskName: string): Promise<TaskProgress[]>
	processTaskWithProgress(
		taskName: string,
		onProgress: (progress: TaskProgress) => void
	): Promise<TaskProgress[]>
	streamTask(taskName: string): AsyncIterable<TaskProgress>
	login(username: string, password: string): Promise<{ message: string }>
	getSecretData(): Promise<{ classified: string; accessedBy: string }>
}

export function createApi(session: { authenticated: boolean; username: string }) {
	const createTaskSteps = (taskName: string): TaskProgress[] => [
		{ percent: 0, status: `${taskName}: Initializing` },
		{ percent: 15, status: `${taskName}: Loading data` },
		{ percent: 35, status: `${taskName}: Validating schema` },
		{ percent: 50, status: `${taskName}: Transforming records` },
		{ percent: 70, status: `${taskName}: Writing output` },
		{ percent: 85, status: `${taskName}: Running checks` },
		{ percent: 100, status: `${taskName}: Complete` }
	]

	const api: MiddlewareDemoAPI = {
		async ping() {
			return "pong"
		},

		async countdown(from: number) {
			return Array.from({ length: Math.max(0, from) + 1 }, (_, index) => from - index)
		},

		async getLogs(service: string, count: number) {
			const levels = ["INFO", "DEBUG", "WARN", "ERROR"]
			const messages = [
				"Request received",
				"Processing payload",
				"Cache hit",
				"Cache miss, fetching from DB",
				"Response sent",
				"Connection closed",
				"Health check passed",
				"Retry attempt"
			]

			return Array.from({ length: Math.max(0, count) }, (_, index) => ({
				timestamp: new Date(Date.now() + index * 250).toISOString(),
				level: levels[index % levels.length]!,
				message: `[${service}#${index}] ${messages[index % messages.length]!}`
			}))
		},

		async processTask(taskName: string) {
			await sleep(200)
			return createTaskSteps(taskName)
		},

		async processTaskWithProgress(taskName: string, onProgress: (progress: TaskProgress) => void) {
			const steps = createTaskSteps(taskName)
			for (const step of steps) {
				await sleep(80)
				onProgress(step)
			}
			return steps
		},

		async *streamTask(taskName: string) {
			for (const step of createTaskSteps(taskName)) {
				await sleep(80)
				yield step
			}
		},

		async login(username: string, password: string) {
			if (password === "demo123") {
				session.authenticated = true
				session.username = username
				return { message: `Welcome, ${username}!` }
			}
			throw new Error("Invalid credentials")
		},

		async getSecretData() {
			return {
				classified: "The answer to life, the universe, and everything is 42.",
				accessedBy: session.username
			}
		}
	}

	return api
}
