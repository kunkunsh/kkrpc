import superjson from "superjson"
import { transferHandlers } from "./transfer-handlers.ts"
import { takeTransferDescriptor } from "./transfer.ts"

/**
 * This file contains the serialization and deserialization helpers for the RPC protocol.
 */
export interface Message<T = any> {
	id: string
	method: string
	args: T
	type: "request" | "response" | "callback" | "get" | "set" | "construct"
	callbackIds?: string[]
	version?: "json" | "superjson"
	path?: string[]
	value?: any
	transferSlots?: TransferSlot[]
}

export interface Response<T = any> {
	result?: T
	error?: string | EnhancedError
}

export interface EnhancedError {
	name: string
	message: string
	stack?: string
	cause?: any
	[key: string]: any
}

export interface SerializationOptions {
	version?: "json" | "superjson"
}

export const TRANSFER_SLOT_PREFIX = "__kkrpc_transfer_"

export interface TransferSlot {
	type: "raw" | "handler"
	handlerName?: string
	metadata?: any
}

export interface WireEnvelope {
	version: 2
	payload: Message<any>
	transferSlots?: TransferSlot[]
	encoding: "object"
	__transferredValues?: unknown[]
}

export type WireV1 = string
export type WireFormat = WireV1 | WireEnvelope

export type EncodedMessage =
	| { mode: "string"; data: string }
	| { mode: "structured"; data: WireEnvelope }

function replacer(_key: string, value: any) {
	if (value instanceof Uint8Array) {
		return {
			type: "Uint8Array",
			data: Array.from(value)
		}
	}
	return value
}

function reviver(_key: string, value: any) {
	if (value && value.type === "Uint8Array" && Array.isArray(value.data)) {
		return new Uint8Array(value.data)
	}
	return value
}

export function serializeError(error: Error): EnhancedError {
	const enhanced: EnhancedError = {
		name: error.name,
		message: error.message
	}

	if (error.stack) {
		enhanced.stack = error.stack
	}

	if ("cause" in error && (error as any).cause !== undefined) {
		enhanced.cause = (error as any).cause
	}

	for (const key in error) {
		if (key !== "name" && key !== "message" && key !== "stack" && key !== "cause") {
			enhanced[key] = (error as any)[key]
		}
	}

	return enhanced
}

export function deserializeError(enhanced: EnhancedError): Error {
	const error = new Error(enhanced.message)
	error.name = enhanced.name

	if (enhanced.stack) {
		error.stack = enhanced.stack
	}

	if (enhanced.cause !== undefined) {
		;(error as any).cause = enhanced.cause
	}

	for (const key in enhanced) {
		if (key !== "name" && key !== "message" && key !== "stack" && key !== "cause") {
			;(error as any)[key] = enhanced[key]
		}
	}

	return error
}

export function serializeMessage<T>(
	message: Message<T>,
	options: SerializationOptions = {}
): string {
	const version = options.version || "superjson"
	const msgWithVersion = { ...message, version }
	return version === "json"
		? JSON.stringify(msgWithVersion, replacer) + "\n"
		: superjson.stringify(msgWithVersion) + "\n"
}

export function deserializeMessage<T>(message: string): Promise<Message<T>> {
	return new Promise((resolve, reject) => {
		try {
			if (message.startsWith('{"json":')) {
				const parsed = superjson.parse<Message<T>>(message)
				resolve(parsed)
			} else {
				const parsed = JSON.parse(message, reviver) as Message<T>
				resolve(parsed)
			}
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

	const envelope: WireEnvelope = {
		version: 2,
		payload: message,
		encoding: "object"
	}

	if (message.transferSlots && message.transferSlots.length > 0) {
		envelope.transferSlots = message.transferSlots
	}

	if (transferredValues.length > 0) {
		envelope.__transferredValues = transferredValues
	}

	return {
		mode: "structured",
		data: envelope
	}
}

export async function decodeMessage<T>(raw: WireFormat): Promise<Message<T>> {
	if (typeof raw === "string") {
		return deserializeMessage<T>(raw)
	}

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

	return payload
}

export function processValueForTransfer(
	value: any,
	transferables: Transferable[] = [],
	transferSlots: TransferSlot[] = [],
	transferredValues: unknown[] = [],
	slotMap: Map<any, number> = new Map()
): any {
	if (value === null || typeof value !== "object") {
		return value
	}

	if (slotMap.has(value)) {
		const slotIndex = slotMap.get(value)!
		return `${TRANSFER_SLOT_PREFIX}${slotIndex}`
	}

	const descriptor = takeTransferDescriptor(value)
	if (descriptor) {
		const slotIndex = transferSlots.length
		slotMap.set(value, slotIndex)
		transferables.push(...descriptor.transfers)
		transferredValues.push(descriptor.value)
		transferSlots.push({
			type: "raw",
			metadata: { original: true }
		})
		return `${TRANSFER_SLOT_PREFIX}${slotIndex}`
	}

	for (const [name, handler] of transferHandlers) {
		if (handler.canHandle(value)) {
			const [serialized, handlerTransferables] = handler.serialize(value)
			const slotIndex = transferSlots.length
			slotMap.set(value, slotIndex)
			transferables.push(...handlerTransferables)
			transferredValues.push(undefined)
			transferSlots.push({
				type: "handler",
				handlerName: name,
				metadata: serialized
			})
			return `${TRANSFER_SLOT_PREFIX}${slotIndex}`
		}
	}

	if (Array.isArray(value)) {
		return value.map((item) =>
			processValueForTransfer(item, transferables, transferSlots, transferredValues, slotMap)
		)
	}

	if (value && value.constructor === Object) {
		const processed: Record<string, any> = {}
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

export function reconstructValueFromTransfer(
	value: any,
	transferSlots: TransferSlot[],
	transferredValues: any[]
): any {
	if (typeof value === "string" && value.startsWith(TRANSFER_SLOT_PREFIX)) {
		const slotIndex = Number.parseInt(value.slice(TRANSFER_SLOT_PREFIX.length), 10)
		const slot = transferSlots[slotIndex]
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

	if (Array.isArray(value)) {
		return value.map((item) => reconstructValueFromTransfer(item, transferSlots, transferredValues))
	}

	if (value && typeof value === "object") {
		const reconstructed: Record<string, any> = {}
		for (const [key, val] of Object.entries(value)) {
			reconstructed[key] = reconstructValueFromTransfer(val, transferSlots, transferredValues)
		}
		return reconstructed
	}

	return value
}
