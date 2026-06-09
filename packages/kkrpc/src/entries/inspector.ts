import type {
	RPCErrorContext,
	RPCPlugin,
	RPCRequestContext,
	RPCResponseContext
} from "../core/plugins.ts"
import type { RPCMessage } from "../core/protocol.ts"

export interface InspectEvent {
	timestamp: number
	direction: "sent" | "received"
	sessionId: string
	message: RPCMessage
	duration?: number
}

export interface InspectorBackend {
	log(event: InspectEvent): void
	flush?(): Promise<void>
	destroy?(): void
}

export interface InspectorOptions {
	filter?: (event: InspectEvent) => boolean
	sanitize?: (event: InspectEvent) => InspectEvent
	trackLatency?: boolean
}

export interface InspectorConfig {
	backends?: InspectorBackend[]
	options?: InspectorOptions
}

export interface InspectorStats {
	totalMessages: number
	sent: number
	received: number
	errors: number
	avgLatency?: number
	methodCounts: Map<string, number>
}

export interface MemoryBackendQuery {
	sessionId?: string
	direction?: InspectEvent["direction"]
}

export class MemoryBackend implements InspectorBackend {
	events: InspectEvent[] = []

	log(event: InspectEvent): void {
		this.events.push(event)
	}

	query(query: MemoryBackendQuery = {}): InspectEvent[] {
		return this.events.filter((event) => {
			if (query.sessionId && event.sessionId !== query.sessionId) return false
			if (query.direction && event.direction !== query.direction) return false
			return true
		})
	}

	clear(): void {
		this.events = []
	}
}

export class KKRPCInspector implements InspectorBackend {
	private readonly requestStarts = new Map<string, number>()
	private readonly latencies: number[] = []
	private readonly stats: InspectorStats = {
		totalMessages: 0,
		sent: 0,
		received: 0,
		errors: 0,
		methodCounts: new Map()
	}

	constructor(
		private readonly config: InspectorConfig = {},
		private readonly backends = config.backends ?? []
	) {}

	log(event: InspectEvent): void {
		this.emit(event)
	}

	emit(event: InspectEvent): void {
		if (this.config.options?.filter && !this.config.options.filter(event)) return
		const sanitized = this.config.options?.sanitize?.(event) ?? event
		this.recordStats(sanitized)
		for (const backend of this.backends) backend.log(sanitized)
	}

	plugin(sessionId = "default"): RPCPlugin {
		return inspectorPlugin(this, sessionId)
	}

	addBackend(backend: InspectorBackend): void {
		this.backends.push(backend)
	}

	removeBackend(backend: InspectorBackend): void {
		const index = this.backends.indexOf(backend)
		if (index === -1) return
		this.backends.splice(index, 1)
		backend.destroy?.()
	}

	getStats(): InspectorStats {
		return {
			...this.stats,
			avgLatency:
				this.latencies.length === 0
					? undefined
					: this.latencies.reduce((total, value) => total + value, 0) / this.latencies.length,
			methodCounts: new Map(this.stats.methodCounts)
		}
	}

	async flush(): Promise<void> {
		await Promise.all(this.backends.map((backend) => backend.flush?.()))
	}

	destroy(): void {
		for (const backend of this.backends) backend.destroy?.()
		this.backends.length = 0
		this.requestStarts.clear()
	}

	private recordStats(event: InspectEvent): void {
		this.stats.totalMessages++
		this.stats[event.direction]++

		if (event.message.t === "q") {
			const method = event.message.p.join(".")
			this.stats.methodCounts.set(method, (this.stats.methodCounts.get(method) ?? 0) + 1)
			if (this.config.options?.trackLatency) this.requestStarts.set(event.message.id, event.timestamp)
			return
		}

		if (event.message.t === "r") {
			if (event.message.e) this.stats.errors++
			const start = this.requestStarts.get(event.message.id)
			if (start !== undefined) {
				this.latencies.push(event.timestamp - start)
				this.requestStarts.delete(event.message.id)
			}
		}
	}
}

export function createInspector(config: InspectorConfig = {}): KKRPCInspector {
	return new KKRPCInspector(config)
}

export function inspectorPlugin(inspector: KKRPCInspector, sessionId = "default"): RPCPlugin {
	return {
		name: "kkrpc-inspector",
		onRequest(ctx) {
			inspector.emit(toRequestEvent(ctx, sessionId))
		},
		onResponse(ctx) {
			inspector.emit(toResponseEvent(ctx, sessionId))
		},
		onError(ctx) {
			inspector.emit(toErrorEvent(ctx, sessionId))
		}
	}
}

export function consoleBackend(pretty = false): InspectorBackend {
	return {
		log(event) {
			const payload = pretty ? JSON.stringify(event, null, 2) : JSON.stringify(event)
			console.log(payload)
		}
	}
}

function toRequestEvent(ctx: RPCRequestContext, sessionId: string): InspectEvent {
	const message: RPCMessage = { t: "q", id: ctx.id, op: ctx.operation, p: ctx.path }
	if (ctx.args.length > 0) message.a = ctx.args
	if ("value" in ctx) message.v = ctx.value
	return { timestamp: Date.now(), direction: "received", sessionId, message }
}

function toResponseEvent(ctx: RPCResponseContext, sessionId: string): InspectEvent {
	return {
		timestamp: Date.now(),
		direction: "sent",
		sessionId,
		message: { t: "r", id: ctx.id, v: ctx.result }
	}
}

function toErrorEvent(ctx: RPCErrorContext, sessionId: string): InspectEvent {
	return {
		timestamp: Date.now(),
		direction: "sent",
		sessionId,
		message: {
			t: "r",
			id: ctx.id,
			e:
				ctx.error instanceof Error
					? { n: ctx.error.name, m: ctx.error.message }
					: { n: "Error", m: String(ctx.error) }
		}
	}
}
