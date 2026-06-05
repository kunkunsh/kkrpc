import { describe, expect, test } from "bun:test"
import superjson from "superjson"
import { deserializeMessage, serializeMessage, type Message } from "../src/serialization.ts"
import {
	decodeJsonMessage,
	encodeJsonMessage,
	jsonSerializationRuntime,
	type Message as JsonMessage
} from "../src/serialization-json.ts"

describe("Serializer", () => {
	test("should serialize and deserialize a message", async () => {
		const message: Message = {
			id: "1",
			method: "testMethod",
			args: [1, 2, 3, new Uint8Array([1, 2, 3])],
			type: "request"
		}
		const serialized = serializeMessage(message)
		const deserialized = await deserializeMessage(serialized)

		// Clone the original message and add the expected version field
		const expectedMessage = { ...message, version: "superjson" }
		expect(deserialized).toEqual(expectedMessage as any)
	})

	test("should serialize and deserialize a message with json version", async () => {
		const message: Message = {
			id: "1",
			method: "testMethod",
			args: [1, 2, 3, new Uint8Array([1, 2, 3])],
			type: "request"
		}
		const serialized = serializeMessage(message, { version: "json" })
		const deserialized = await deserializeMessage(serialized)

		// Clone the original message and add the expected version field
		const expectedMessage = { ...message, version: "json" }
		expect(deserialized).toEqual(expectedMessage as any)
	})

	test("should serialize and deserialize a superjson message", async () => {
		const message: Message = {
			id: "1",
			method: "testMethod",
			args: [1, 2, 3, new Uint8Array([1, 2, 3])],
			type: "request"
		}
		const serialized = superjson.stringify(message)
		const deserialized = superjson.parse(serialized)
		expect(deserialized).toEqual(message as any)
	})

	test("default compatibility serializer still uses SuperJSON", async () => {
		const message: Message<unknown[]> = {
			id: "superjson-default",
			method: "date.echo",
			args: [new Date("2026-06-05T00:00:00.000Z")],
			type: "request"
		}

		const serialized = serializeMessage(message)
		expect(serialized.startsWith('{"json":')).toBe(true)

		const deserialized = await deserializeMessage<unknown[]>(serialized)
		expect(deserialized.args[0]).toBeInstanceOf(Date)
	})
})

describe("JSON-only serialization", () => {
	test("round-trips JSON messages without SuperJSON", async () => {
		const message: JsonMessage = {
			id: "json-1",
			method: "echo",
			args: ["hello", new Uint8Array([1, 2, 3])],
			type: "request"
		}

		const serialized = encodeJsonMessage(message)
		const deserialized = await decodeJsonMessage(serialized)

		expect(deserialized).toEqual({ ...message, version: "json" } as JsonMessage)
	})

	test("rejects SuperJSON-looking strings with a clear lite error", async () => {
		const superjsonLike = '{"json":{"id":"1","method":"echo","args":[],"type":"request"}}\n'

		await expect(decodeJsonMessage(superjsonLike)).rejects.toThrow(
			"Received a SuperJSON-encoded kkrpc message"
		)
	})

	test("encodes structured envelopes without SuperJSON", async () => {
		const message: JsonMessage = {
			id: "structured-1",
			method: "echo",
			args: ["hello"],
			type: "request"
		}

		const encoded = jsonSerializationRuntime.encodeMessage(message, {}, true)

		expect(encoded.mode).toBe("structured")
		if (encoded.mode !== "structured") {
			expect.unreachable("expected structured encoding")
		}
		expect(encoded.data.payload).toEqual(message)
		expect(await jsonSerializationRuntime.decodeMessage(encoded.data)).toEqual(message)
	})
})
