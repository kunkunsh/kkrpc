/**
 * JSON-only kkrpc serialization runtime.
 * Browser-lite imports this module to keep SuperJSON out of the dependency graph
 * while preserving JSON string messages, structured envelopes, transfer slots,
 * and rich error serialization.
 */
import { transferHandlers } from "./transfer-handlers.ts"
import { takeTransferDescriptor } from "./transfer.ts"
import {
	TRANSFER_SLOT_PREFIX,
	type EncodedMessage,
	type EnhancedError,
	type Message,
	type RPCSerializationRuntime,
	type SerializationOptions,
	type TransferSlot,
	type WireEnvelope,
	type WireFormat
} from "./serialization-types.ts"

export {
	TRANSFER_SLOT_PREFIX,
	type EncodedMessage,
	type EnhancedError,
	type Message,
	type RPCMessageMetadata,
	type RPCSerializationRuntime,
	type Response,
	type SerializationOptions,
	type TransferSlot,
	type WireEnvelope,
	type WireFormat,
	type WireV1
} from "./serialization-types.ts"

// Transfer placeholders are tagged objects instead of strings so user strings never collide.
const TRANSFER_SLOT_PLACEHOLDER_KEY = "__kkrpc_transfer_slot__"
const TRANSFER_SLOT_PLACEHOLDER_TOKEN_KEY = "__kkrpc_transfer_token__"

interface TransferPlaceholder {
	slotIndex: number
	token: string
}

type ErrorWithProperties = Error & Record<string, unknown>

/** Creates a message-local token to distinguish real placeholders from user objects. */
function createTransferToken(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** Replaces a transferred value in the JSON payload with a small tagged reference. */
function createTransferPlaceholder(slotIndex: number, token: string): Record<string, number | string> {
	return {
		[TRANSFER_SLOT_PLACEHOLDER_KEY]: slotIndex,
		[TRANSFER_SLOT_PLACEHOLDER_TOKEN_KEY]: token
	}
}

/** Only traverse plain objects; Dates, Maps, class instances, etc. should keep identity. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object") return false
	const prototype = Object.getPrototypeOf(value)
	return prototype === Object.prototype || prototype === null
}

/** Returns a transfer placeholder only when the object exactly matches our tagged shape. */
function getTransferPlaceholder(value: unknown): TransferPlaceholder | undefined {
	if (!isPlainObject(value)) return undefined
	const keys = Object.keys(value)
	if (
		keys.length !== 2 ||
		!keys.includes(TRANSFER_SLOT_PLACEHOLDER_KEY) ||
		!keys.includes(TRANSFER_SLOT_PLACEHOLDER_TOKEN_KEY)
	) {
		return undefined
	}
	const slotIndex = value[TRANSFER_SLOT_PLACEHOLDER_KEY]
	const token = value[TRANSFER_SLOT_PLACEHOLDER_TOKEN_KEY]
	return typeof slotIndex === "number" && Number.isInteger(slotIndex) && typeof token === "string"
		? { slotIndex, token }
		: undefined
}

function replacer(_key: string, value: unknown): unknown {
	if (value instanceof Uint8Array) {
		return {
			type: "Uint8Array",
			data: Array.from(value)
		}
	}
	return value
}

function reviver(_key: string, value: unknown): unknown {
	if (isPlainObject(value) && value.type === "Uint8Array" && Array.isArray(value.data)) {
		return new Uint8Array(value.data as number[])
	}
	return value
}

export function serializeError(error: Error): EnhancedError {
	const errorWithProperties = error as ErrorWithProperties
	const enhanced: EnhancedError = {
		name: error.name,
		message: error.message
	}

	if (error.stack) {
		enhanced.stack = error.stack
	}

	if ("cause" in errorWithProperties && errorWithProperties.cause !== undefined) {
		enhanced.cause = errorWithProperties.cause
	}

	for (const key in errorWithProperties) {
		if (key !== "name" && key !== "message" && key !== "stack" && key !== "cause") {
			enhanced[key] = errorWithProperties[key]
		}
	}

	return enhanced
}

export function deserializeError(enhanced: EnhancedError): Error {
	const error = new Error(enhanced.message)
	const errorWithProperties = error as ErrorWithProperties
	error.name = enhanced.name

	if (enhanced.stack) {
		error.stack = enhanced.stack
	}

	if (enhanced.cause !== undefined) {
		errorWithProperties.cause = enhanced.cause
	}

	for (const key in enhanced) {
		if (key !== "name" && key !== "message" && key !== "stack" && key !== "cause") {
			errorWithProperties[key] = enhanced[key]
		}
	}

	return error
}

export function encodeJsonMessage<T>(message: Message<T>): string {
	return JSON.stringify({ ...message, version: "json" }, replacer) + "\n"
}

export function decodeJsonMessage<T>(message: string): Promise<Message<T>> {
	return new Promise((resolve, reject) => {
		try {
			if (message.trimStart().startsWith('{"json":')) {
				reject(
					new Error(
						'Received a SuperJSON-encoded kkrpc message, but this entrypoint is JSON-only. Use kkrpc/browser or configure both endpoints with serialization.version = "json".'
					)
				)
				return
			}
			resolve(JSON.parse(message, reviver) as Message<T>)
		} catch (error) {
			console.error("failed to parse message", typeof message, message, error)
			reject(error)
		}
	})
}

export function encodeStructuredMessage<T>(
	message: Message<T>,
	transferredValues: unknown[] = []
): WireEnvelope {
	const envelope: WireEnvelope = {
		version: 2,
		payload: message as Message<unknown>,
		encoding: "object"
	}

	if (message.transferSlots && message.transferSlots.length > 0) {
		envelope.transferSlots = message.transferSlots
	}

	if (transferredValues.length > 0) {
		envelope.__transferredValues = transferredValues
	}

	return envelope
}

export function decodeStructuredMessage<T>(raw: WireEnvelope): Promise<Message<T>> {
	const payload = raw.payload as Message<T>

	if (raw.transferSlots?.length) {
		payload.transferSlots = raw.transferSlots
	}

	if (Array.isArray(raw.__transferredValues)) {
		Object.defineProperty(payload, "__transferredValues", {
			value: raw.__transferredValues,
			enumerable: false,
			configurable: true
		})
	}

	return Promise.resolve(payload)
}

export function encodeMessage<T>(
	message: Message<T>,
	options: SerializationOptions,
	withTransfers: boolean,
	transferredValues: unknown[] = []
): EncodedMessage {
	if (options.version === "superjson") {
		throw new Error(
			'SuperJSON serialization is not available in kkrpc/browser-lite. Use kkrpc/browser or configure both endpoints with serialization.version = "json".'
		)
	}

	if (!withTransfers) {
		return {
			mode: "string",
			data: encodeJsonMessage(message)
		}
	}

	return {
		mode: "structured",
		data: encodeStructuredMessage(message, transferredValues)
	}
}

export async function decodeMessage<T>(raw: WireFormat): Promise<Message<T>> {
	if (typeof raw === "string") {
		return decodeJsonMessage<T>(raw)
	}

	return decodeStructuredMessage<T>(raw)
}

export function processValueForTransfer<T>(
	value: T,
	transferables?: Transferable[],
	transferSlots?: TransferSlot[],
	transferredValues?: unknown[],
	slotMap?: Map<object, number>
): T
export function processValueForTransfer(
	value: unknown,
	transferables: Transferable[] = [],
	transferSlots: TransferSlot[] = [],
	transferredValues: unknown[] = [],
	slotMap: Map<object, number> = new Map()
): unknown {
	if (value === null || typeof value !== "object") {
		return value
	}

	if (slotMap.has(value)) {
		const slotIndex = slotMap.get(value)!
		// Preserve shared references by pointing repeat occurrences at the first transfer slot.
		return createTransferPlaceholder(slotIndex, transferSlots[slotIndex]?.token ?? "")
	}

	const descriptor = takeTransferDescriptor(value)
	if (descriptor) {
		// Explicit transfer(value, transfers) gets the raw transferred value on structured transports.
		const slotIndex = transferSlots.length
		const token = createTransferToken()
		slotMap.set(value, slotIndex)
		transferables.push(...descriptor.transfers)
		transferredValues.push(descriptor.value)
		transferSlots.push({
			type: "raw",
			metadata: { original: true },
			token
		})
		return createTransferPlaceholder(slotIndex, token)
	}

	for (const [name, handler] of transferHandlers) {
		if (handler.canHandle(value)) {
			// Registered handlers can serialize custom transferable-like objects into metadata.
			const [serialized, handlerTransferables] = handler.serialize(value)
			const slotIndex = transferSlots.length
			const token = createTransferToken()
			slotMap.set(value, slotIndex)
			transferables.push(...handlerTransferables)
			transferredValues.push(undefined)
			transferSlots.push({
				type: "handler",
				handlerName: name,
				metadata: serialized,
				token
			})
			return createTransferPlaceholder(slotIndex, token)
		}
	}

	if (Array.isArray(value)) {
		return value.map((item) =>
			processValueForTransfer(item, transferables, transferSlots, transferredValues, slotMap)
		)
	}

	if (isPlainObject(value)) {
		// Recurse only through plain payload containers to avoid corrupting runtime objects.
		const processed: Record<string, unknown> = {}
		for (const [key, val] of Object.entries(value)) {
			processed[key] = processValueForTransfer(
				val,
				transferables,
				transferSlots,
				transferredValues,
				slotMap
			)
		}
		return processed
	}

	return value
}

export function reconstructValueFromTransfer<T>(
	value: T,
	transferSlots: TransferSlot[],
	transferredValues: unknown[]
): T
export function reconstructValueFromTransfer(
	value: unknown,
	transferSlots: TransferSlot[],
	transferredValues: unknown[]
): unknown {
	const placeholder = getTransferPlaceholder(value)
	if (placeholder !== undefined) {
		const { slotIndex } = placeholder
		const slot = transferSlots[slotIndex]
		if (slot?.token !== placeholder.token) {
			// Not a placeholder from this message; preserve user data with the same shape.
		} else {
			const transferredValue = transferredValues[slotIndex]

			if (slot?.type === "raw") {
				if (transferredValue === undefined) {
					throw new Error(`Missing transferred value for slot ${slotIndex}`)
				}
				return transferredValue
			}

			if (slot?.type === "handler" && slot.handlerName) {
				const handler = transferHandlers.get(slot.handlerName)
				if (!handler) {
					throw new Error(`Unknown transfer handler: ${slot.handlerName}`)
				}
				return handler.deserialize(slot.metadata)
			}

			throw new Error(`Invalid transfer slot: ${slotIndex}`)
		}
	}

	if (Array.isArray(value)) {
		return value.map((item) => reconstructValueFromTransfer(item, transferSlots, transferredValues))
	}

	if (isPlainObject(value)) {
		const reconstructed: Record<string, unknown> = {}
		for (const [key, val] of Object.entries(value)) {
			reconstructed[key] = reconstructValueFromTransfer(val, transferSlots, transferredValues)
		}
		return reconstructed
	}

	return value
}

export const jsonSerializationRuntime: RPCSerializationRuntime = {
	encodeMessage,
	decodeMessage,
	serializeError,
	deserializeError
}
