import type { RPCMessage } from "./core/protocol.ts"
import type { Transport } from "./core/transport.ts"
import { MAX_RPC_DEPTH } from "./core/utils.ts"

/** Controller returned by `relayTransport()` for stopping a relay. */
export interface RelayController {
	/** Stop forwarding messages in both directions. */
	dispose(): void
}

/** Options for `relayTransport()`. */
export interface RelayTransportOptions {
	/**
	 * Called once after the relay auto-disposes because one side's connection
	 * closed. Requires the closing transport to implement `onClose`.
	 */
	onClose?: (side: "left" | "right", reason?: Error) => void
	/** Also close the surviving side's transport when one side closes. Default `false`. */
	closeOtherSide?: boolean
}

/**
 * Relay messages bidirectionally between two transports.
 *
 * The relay forwards raw compact RPC messages without exposing a local API. When
 * the destination transport supports transferables, transferable objects found in
 * the message payload are forwarded with the send call.
 *
 * When a transport implements `onClose`, the relay auto-disposes once either side
 * closes, since a closed side can no longer forward. Transports without `onClose`
 * behave exactly as before.
 */
export function relayTransport(
	left: Transport<RPCMessage>,
	right: Transport<RPCMessage>,
	options?: RelayTransportOptions
): RelayController {
	let disposed = false
	const unsubscribeLeft = left.subscribe((message) =>
		forwardMessage("left-to-right", right, message)
	)
	const unsubscribeRight = right.subscribe((message) =>
		forwardMessage("right-to-left", left, message)
	)

	const dispose = () => {
		if (disposed) return
		disposed = true
		unsubscribeLeft()
		unsubscribeRight()
		unsubscribeLeftClose?.()
		unsubscribeRightClose?.()
	}

	const onSideClose = (side: "left" | "right", reason?: Error) => {
		if (disposed) return
		dispose()
		if (options?.closeOtherSide) (side === "left" ? right : left).close?.()
		options?.onClose?.(side, reason)
	}

	const unsubscribeLeftClose = left.onClose?.((reason) => onSideClose("left", reason))
	const unsubscribeRightClose = right.onClose?.((reason) => onSideClose("right", reason))

	return { dispose }
}

function forwardMessage(
	direction: "left-to-right" | "right-to-left",
	target: Transport<RPCMessage>,
	message: RPCMessage
): void {
	try {
		const transfers = target.capabilities?.transfer === true ? collectTransferables(message) : []
		void Promise.resolve(target.send(message, transfers)).catch((error) =>
			reportRelayError(direction, error)
		)
	} catch (error) {
		reportRelayError(direction, error)
	}
}

function collectTransferables(value: unknown): Transferable[] {
	const transfers: Transferable[] = []
	const seen = new WeakSet<object>()
	visitTransferables(value, transfers, seen)
	return transfers
}

function visitTransferables(
	value: unknown,
	transfers: Transferable[],
	seen: WeakSet<object>,
	depth = 0
): void {
	if (typeof value !== "object" || value === null) return
	// Stop descending past the depth cap: deeper transferables fall back to
	// structured clone rather than risking a stack overflow on hostile input.
	if (depth > MAX_RPC_DEPTH) return
	if (seen.has(value)) return
	seen.add(value)

	if (Array.isArray(value)) {
		for (const item of value) visitTransferables(item, transfers, seen, depth + 1)
		return
	}

	if (isTransferable(value)) {
		transfers.push(value)
		return
	}

	for (const item of Object.values(value as Record<string, unknown>)) {
		visitTransferables(item, transfers, seen, depth + 1)
	}
}

function isTransferable(value: object): value is Transferable {
	return (
		value instanceof ArrayBuffer ||
		(typeof MessagePort !== "undefined" && value instanceof MessagePort) ||
		(typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) ||
		(typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas) ||
		(typeof ReadableStream !== "undefined" && value instanceof ReadableStream) ||
		(typeof WritableStream !== "undefined" && value instanceof WritableStream) ||
		(typeof TransformStream !== "undefined" && value instanceof TransformStream)
	)
}

function reportRelayError(direction: "left-to-right" | "right-to-left", error: unknown): void {
	console.error(`[kkrpc relay] Failed to forward ${direction}`, error)
}
