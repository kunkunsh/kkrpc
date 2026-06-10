/**
 * Socket.IO transport for stable kkrpc.
 *
 * Socket.IO already provides a bidirectional event channel. This adapter sends
 * compact RPC messages over a dedicated event name, supports callback arguments,
 * and does not support transferable ownership moves.
 */

import type { RPCMessage } from "../core/protocol.ts"
import type { Transport } from "../core/transport.ts"

/** Event name used for kkrpc messages on a Socket.IO connection. */
export const SOCKET_IO_EVENT = "kkrpc:message"

/** Minimal Socket.IO socket shape used by `socketIoTransport()`. */
export interface SocketLike {
	emit(event: typeof SOCKET_IO_EVENT, message: RPCMessage): void
	on(event: typeof SOCKET_IO_EVENT, listener: (message: RPCMessage) => void): void
	off(event: typeof SOCKET_IO_EVENT, listener: (message: RPCMessage) => void): void
	disconnect?(): void
}

/**
 * Wrap a Socket.IO client or server socket as a kkrpc transport.
 *
 * The transport is bidirectional and callback-capable. `close()` calls
 * `disconnect()` when the socket implementation exposes it.
 */
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
