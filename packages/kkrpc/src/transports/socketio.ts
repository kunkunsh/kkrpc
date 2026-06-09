import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

export const SOCKET_IO_EVENT = "kkrpc:message"

export interface SocketLike {
	emit(event: typeof SOCKET_IO_EVENT, message: RPCMessage): void
	on(event: typeof SOCKET_IO_EVENT, listener: (message: RPCMessage) => void): void
	off(event: typeof SOCKET_IO_EVENT, listener: (message: RPCMessage) => void): void
	disconnect?(): void
}

export function socketIoTransport(socket: SocketLike): Transport<RPCMessage> {
	return {
		capabilities: { objectMode: true, transfer: false },
		send(message) {
			socket.emit(SOCKET_IO_EVENT, message)
		},
		subscribe(listener) {
			socket.on(SOCKET_IO_EVENT, listener)
			return () => socket.off(SOCKET_IO_EVENT, listener)
		},
		close() {
			socket.disconnect?.()
		}
	}
}
