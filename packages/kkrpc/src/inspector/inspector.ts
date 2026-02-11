import type { IoInterface } from "../interface.ts"
import type { Message } from "../serialization.ts"
import { InspectableIo } from "./inspectable-io.ts"
import type { InspectEvent, InspectorBackend, InspectorOptions } from "./types.ts"

export interface InspectorConfig {
	backends: InspectorBackend[]
	options?: InspectorOptions
}

export class KKRPCInspector implements InspectorBackend {
	private backends: InspectorBackend[]
	private options: InspectorOptions

	constructor(config: InspectorConfig) {
		this.backends = config.backends
		this.options = config.options ?? {}
	}

	log(event: InspectEvent): void {
		this.emit(event)
	}

	wrap(io: IoInterface, sessionId: string): IoInterface {
		return new InspectableIo(io, this, sessionId, this.options)
	}

	emit(event: InspectEvent): void {
		if (this.options.filter && !this.options.filter(event.message)) {
			return
		}

		const sanitizedEvent = this.options.sanitize
			? { ...event, message: this.options.sanitize(event.message) }
			: event

		for (const backend of this.backends) {
			try {
				backend.log(sanitizedEvent)
			} catch (e) {
				console.error("[kkrpc-inspector] Backend error:", e)
			}
		}
	}

	/**
	 * Add a backend dynamically
	 */
	addBackend(backend: InspectorBackend): void {
		this.backends.push(backend)
	}

	/**
	 * Remove a backend
	 */
	removeBackend(backend: InspectorBackend): void {
		const index = this.backends.indexOf(backend)
		if (index > -1) {
			this.backends.splice(index, 1)
			backend.destroy?.()
		}
	}

	/**
	 * Flush all backends that support flushing
	 */
	async flush(): Promise<void> {
		await Promise.all(
			this.backends
				.filter(
					(b): b is InspectorBackend & { flush(): Promise<void> } => typeof b.flush === "function"
				)
				.map((b) => b.flush().catch(console.error))
		)
	}

	/**
	 * Destroy all backends
	 */
	destroy(): void {
		for (const backend of this.backends) {
			backend.destroy?.()
		}
		this.backends = []
	}
}

export function createInspector(config: InspectorConfig): KKRPCInspector {
	return new KKRPCInspector(config)
}
