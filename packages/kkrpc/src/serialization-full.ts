/**
 * Full kkrpc serialization runtime with SuperJSON support.
 * Existing package entrypoints import this module to preserve the current
 * default behavior for Date, Map, Set, BigInt, Uint8Array, and legacy messages.
 */
import superjson from "superjson"
import {
	decodeMessage as decodeJsonWireMessage,
	decodeStructuredMessage,
	deserializeError,
	encodeJsonMessage,
	encodeStructuredMessage,
	processValueForTransfer,
	reconstructValueFromTransfer,
	serializeError
} from "./serialization-json.ts"
import type {
	EncodedMessage,
	Message,
	RPCSerializationRuntime,
	SerializationOptions,
	WireFormat
} from "./serialization-types.ts"

export type {
	EncodedMessage,
	EnhancedError,
	Message,
	RPCMessageMetadata,
	RPCSerializationRuntime,
	Response,
	SerializationOptions,
	TransferSlot,
	WireEnvelope,
	WireFormat,
	WireV1
} from "./serialization-types.ts"

export { deserializeError, processValueForTransfer, reconstructValueFromTransfer, serializeError }

export function serializeMessage<T>(
	message: Message<T>,
	options: SerializationOptions = {}
): string {
	const version = options.version || "superjson"
	const msgWithVersion = { ...message, version }
	return version === "json" ? encodeJsonMessage(message) : superjson.stringify(msgWithVersion) + "\n"
}

export function deserializeMessage<T>(message: string): Promise<Message<T>> {
	return new Promise((resolve, reject) => {
		try {
			if (message.trimStart().startsWith('{"json":')) {
				resolve(superjson.parse<Message<T>>(message))
				return
			}
			decodeJsonWireMessage<T>(message).then(resolve, reject)
		} catch (error) {
			console.error("failed to parse message", typeof message, message, error)
			reject(error)
		}
	})
}

export function encodeMessage<T>(
	message: Message<T>,
	options: SerializationOptions,
	withTransfers: boolean,
	transferredValues: unknown[] = []
): EncodedMessage {
	if (!withTransfers) {
		return {
			mode: "string",
			data: serializeMessage(message, options)
		}
	}

	return {
		mode: "structured",
		data: encodeStructuredMessage(message, transferredValues)
	}
}

export async function decodeMessage<T>(raw: WireFormat): Promise<Message<T>> {
	if (typeof raw === "string") {
		return deserializeMessage<T>(raw)
	}

	return decodeStructuredMessage<T>(raw)
}

export const fullSerializationRuntime: RPCSerializationRuntime = {
	encodeMessage,
	decodeMessage,
	serializeError,
	deserializeError
}
