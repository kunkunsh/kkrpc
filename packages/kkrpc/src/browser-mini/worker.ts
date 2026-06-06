import type { MiniMessage, MiniTransport } from "./types.ts"

type MessageTargetLike = {
	postMessage(message: MiniMessage, transfer?: Transferable[]): void
	addEventListener(type: "message", listener: (event: MessageEvent) => void): void
	removeEventListener(type: "message", listener: (event: MessageEvent) => void): void
}

type WorkerScopeLike = MessageTargetLike & {
	close?(): void
}

export class WorkerParentIO implements MiniTransport {
	canTransfer = true

	constructor(private worker: Worker) {}

	post(message: MiniMessage, transfers: Transferable[] = []): void {
		if (transfers.length > 0) {
			this.worker.postMessage(message, transfers)
			return
		}
		this.worker.postMessage(message)
	}

	onMessage(listener: (message: MiniMessage) => void): () => void {
		const handler = (event: MessageEvent) => listener(event.data as MiniMessage)
		this.worker.addEventListener("message", handler)
		return () => this.worker.removeEventListener("message", handler)
	}

	destroy(): void {
		this.worker.terminate()
	}
}

export class WorkerChildIO implements MiniTransport {
	canTransfer = true
	private scope: WorkerScopeLike

	constructor(scope: WorkerScopeLike = globalThis as unknown as WorkerScopeLike) {
		this.scope = scope
	}

	post(message: MiniMessage, transfers: Transferable[] = []): void {
		if (transfers.length > 0) {
			this.scope.postMessage(message, transfers)
			return
		}
		this.scope.postMessage(message)
	}

	onMessage(listener: (message: MiniMessage) => void): () => void {
		const handler = (event: MessageEvent) => listener(event.data as MiniMessage)
		this.scope.addEventListener("message", handler)
		return () => this.scope.removeEventListener("message", handler)
	}

	destroy(): void {
		this.scope.close?.()
	}
}
