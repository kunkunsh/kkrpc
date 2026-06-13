import { describe, expect, test } from "bun:test"
import type { RPCMessage } from "../src/entries/mod.ts"
import {
	createBusEnvelope,
	isBusEnvelope,
	parseBusEnvelope,
	shouldDeliverBusEnvelope
} from "../src/transports/bus-envelope.ts"

describe("bus envelope", () => {
	test("wraps RPC messages with routing metadata", () => {
		const message: RPCMessage = { t: "q", id: "request-1", op: "call", p: ["echo"], a: ["ok"] }
		const envelope = createBusEnvelope(message, {
			transportId: "bus",
			from: "client",
			to: "server"
		})

		expect(envelope.protocol).toBe("kkrpc.bus.v1")
		expect(envelope.transportId).toBe("bus")
		expect(envelope.from).toBe("client")
		expect(envelope.to).toBe("server")
		expect(envelope.correlationId).toBe("request-1")
		expect(envelope.message).toEqual(message)
	})

	test("filters self messages and messages addressed to other peers", () => {
		const message: RPCMessage = { t: "r", id: "request-1", v: "ok" }
		expect(
			shouldDeliverBusEnvelope(createBusEnvelope(message, { transportId: "bus", from: "client" }), {
				localPeerId: "client"
			})
		).toBe(false)
		expect(
			shouldDeliverBusEnvelope(
				createBusEnvelope(message, { transportId: "bus", from: "client", to: "server" }),
				{
					localPeerId: "other"
				}
			)
		).toBe(false)
		expect(
			shouldDeliverBusEnvelope(
				createBusEnvelope(message, { transportId: "bus", from: "client", to: "server" }),
				{
					localPeerId: "server"
				}
			)
		).toBe(true)
	})

	test("safely parses and validates bus envelopes", () => {
		const message: RPCMessage = { t: "q", id: "request-1", op: "call", p: ["echo"] }
		const envelope = createBusEnvelope(message, { transportId: "bus", from: "client" })

		expect(parseBusEnvelope(JSON.stringify(envelope))).toEqual(envelope)
		expect(parseBusEnvelope("not-json")).toBeNull()
		expect(
			parseBusEnvelope(JSON.stringify({ ...envelope, message: { t: "q", id: "request-1" } }))
		).toBeNull()
		expect(isBusEnvelope({ ...envelope, message: { t: "unknown", id: "request-1" } })).toBe(false)
	})

	test("accepts remote reference request envelopes for bus transports", () => {
		const message: RPCMessage = { t: "q", id: "ref-1", op: "ref", p: ["callback", "apply"], a: [] }
		const envelope = createBusEnvelope(message, {
			transportId: "bus",
			from: "client",
			to: "server"
		})

		expect(isBusEnvelope(envelope)).toBe(true)
		expect(parseBusEnvelope(JSON.stringify(envelope))?.message).toEqual(message)
		expect(shouldDeliverBusEnvelope(envelope, { localPeerId: "server" })).toBe(true)
	})

	test("accepts streaming control and data envelopes for bus transports", () => {
		const control: RPCMessage = { t: "sq", id: "pull-1", sid: "stream-1", op: "pull", n: 32 }
		const data: RPCMessage = { t: "sr", id: "chunk-1", sid: "stream-1", d: false, v: 1 }
		const controlEnvelope = createBusEnvelope(control, {
			transportId: "bus",
			from: "client",
			to: "server"
		})
		const dataEnvelope = createBusEnvelope(data, {
			transportId: "bus",
			from: "server",
			to: "client"
		})

		expect(isBusEnvelope(controlEnvelope)).toBe(true)
		expect(isBusEnvelope(dataEnvelope)).toBe(true)
		expect(parseBusEnvelope(JSON.stringify(controlEnvelope))?.message).toEqual(control)
		expect(parseBusEnvelope(JSON.stringify(dataEnvelope))?.message).toEqual(data)
	})
})
