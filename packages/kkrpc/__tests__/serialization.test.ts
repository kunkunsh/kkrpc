import { describe, expect, test } from "bun:test"
import superjson from "superjson"
import { deserializeMessage, serializeMessage, type Message } from "../src/serialization.ts"

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

	// test("should serialize and deserialize a response", async () => {
	// 	const response = {
	// 		id: 1
	// 	}
	// 	const serializedResponse = serializeResponse(response as any)
	// 	const deserializedResponse = await deserializeResponse(serializedResponse)
	// 	expect(deserializedResponse).toEqual(response as any)
	// })

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
})
