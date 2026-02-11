import type { InspectEvent, InspectorBackend, InspectorStats } from "../types.ts"

export interface MemoryBackendQuery {
	sessionId?: string
	method?: string
	type?: string
	startTime?: number
	endTime?: number
	direction?: "sent" | "received"
	hasError?: boolean
}

export class MemoryBackend implements InspectorBackend {
	public events: InspectEvent[] = []
	private stats: InspectorStats = {
		totalMessages: 0,
		sent: 0,
		received: 0,
		errors: 0,
		methodCounts: new Map()
	}

	log(event: InspectEvent): void {
		this.events.push(event)
		this.updateStats(event)
	}

	query(filter: MemoryBackendQuery): InspectEvent[] {
		return this.events.filter((e) => {
			if (filter.sessionId && e.sessionId !== filter.sessionId) return false
			if (filter.method && !e.message.method?.includes(filter.method)) return false
			if (filter.type && e.message.type !== filter.type) return false
			if (filter.direction && e.direction !== filter.direction) return false
			if (filter.startTime && e.timestamp < filter.startTime) return false
			if (filter.endTime && e.timestamp > filter.endTime) return false
			if (filter.hasError !== undefined) {
				const hasError = this.hasError(e)
				if (hasError !== filter.hasError) return false
			}
			return true
		})
	}

	getStats(): InspectorStats {
		const methodCounts = new Map(this.stats.methodCounts)
		let avgLatency: number | undefined

		if (this.stats.totalMessages > 0) {
			const latencies = this.events.filter((e) => e.duration !== undefined).map((e) => e.duration!)

			if (latencies.length > 0) {
				avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length
			}
		}

		return {
			...this.stats,
			methodCounts,
			avgLatency
		}
	}

	clear(): void {
		this.events = []
		this.stats = {
			totalMessages: 0,
			sent: 0,
			received: 0,
			errors: 0,
			methodCounts: new Map()
		}
	}

	getEvents(): readonly InspectEvent[] {
		return this.events
	}

	findRequestResponsePair(responseId: string): { request?: InspectEvent; response?: InspectEvent } {
		const response = this.events.find(
			(e) => e.message.id === responseId && e.message.type === "response"
		)
		const request = this.events.find(
			(e) => e.message.id === responseId && e.message.type === "request"
		)
		return { request, response }
	}

	private updateStats(event: InspectEvent): void {
		this.stats.totalMessages++

		if (event.direction === "sent") {
			this.stats.sent++
		} else {
			this.stats.received++
		}

		if (this.hasError(event)) {
			this.stats.errors++
		}

		const method = event.message.method || "unknown"
		this.stats.methodCounts.set(method, (this.stats.methodCounts.get(method) || 0) + 1)
	}

	private hasError(event: InspectEvent): boolean {
		const args = event.message.args as { error?: unknown } | undefined
		return args !== undefined && "error" in args && args.error !== undefined
	}
}
