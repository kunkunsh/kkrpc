export interface MiniError {
	n: string
	m: string
	s?: string
}

export type MiniOperation = "call" | "get" | "set" | "new"

export interface MiniRequest {
	t: "q"
	id: string
	op: MiniOperation
	p: string[]
	a?: unknown[]
	v?: unknown
}

export interface MiniResponse {
	t: "r"
	id: string
	v?: unknown
	e?: MiniError
}

export interface MiniCallback {
	t: "cb"
	id: string
	a: unknown[]
}

export type MiniMessage = MiniRequest | MiniResponse | MiniCallback

export interface MiniTransport {
	post(message: MiniMessage, transfers?: Transferable[]): void | Promise<void>
	onMessage(listener: (message: MiniMessage) => void): () => void
	destroy?(): void
	canTransfer?: boolean
}
