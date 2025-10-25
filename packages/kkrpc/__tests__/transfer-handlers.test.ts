import { 
  transferHandlers, 
  transfer, 
  proxy, 
  proxyMarker, 
  type TransferHandler,
  type ProxyMarked,
  serializeMessage,
  deserializeMessage,
  toWireValue,
  fromWireValue
} from "../src/serialization.ts"
import { describe, beforeEach, it, expect } from 'bun:test'

describe("Transfer Handlers System", () => {
  beforeEach(() => {
    // Clear any custom handlers before each test
    transferHandlers.clear()
    // Re-register built-in handlers
    transferHandlers.set("proxy", {
      canHandle: (val): val is ProxyMarked =>
        typeof val === "object" && val !== null && (val as ProxyMarked)[proxyMarker],
      serialize(obj) {
        const id = `proxy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        return { type: "proxy", id }
      },
      deserialize(data) {
        return { __kkrpc_proxy__: true, id: data.id }
      },
    } as TransferHandler<object, { type: "proxy"; id: string }>)
    
    transferHandlers.set("error", {
      canHandle: (val): val is Error => val instanceof Error,
      serialize(error) {
        return {
          name: error.name,
          message: error.message,
          stack: error.stack
        }
      },
      deserialize(enhanced) {
        const error = new Error(enhanced.message)
        error.name = enhanced.name
        if (enhanced.stack) {
          error.stack = enhanced.stack
        }
        return error
      },
    } as TransferHandler<Error, any>)
  })

  it("should register and use custom transfer handlers", () => {
    // Define a custom transfer handler for Date objects
    const dateHandler: TransferHandler<Date, string> = {
      canHandle: (value): value is Date => value instanceof Date,
      serialize: (date) => date.toISOString(),
      deserialize: (isoString) => new Date(isoString)
    }

    // Register custom handler
    transferHandlers.set("date", dateHandler)

    // Test serialization
    const testDate = new Date("2023-01-01T00:00:00.000Z")
    const [wireValue, transfers] = toWireValue(testDate)

    expect(wireValue).toEqual({
      type: "handler",
      name: "date",
      value: "2023-01-01T00:00:00.000Z"
    })
    expect(transfers).toEqual([])

    // Test deserialization
    const deserialized = fromWireValue(wireValue)
    expect(deserialized).toEqual(testDate)
  })

  it("should handle proxy objects with built-in handler", () => {
    const testObj = { name: "test", value: 42 }
    const proxyObj = proxy(testObj)

    expect(proxyObj[proxyMarker]).toBe(true)

    const [wireValue, transfers] = toWireValue(proxyObj)

    expect(wireValue).toEqual({
      type: "handler",
      name: "proxy",
      value: { type: "proxy", id: expect.stringMatching(/^proxy_\d+_\w+$/) }
    })
    expect(transfers).toEqual([])

    // Test deserialization
    const deserialized = fromWireValue(wireValue)
    expect(deserialized).toEqual({ __kkrpc_proxy__: true, id: expect.stringMatching(/^proxy_\d+_\w+$/) })
  })

  it("should handle Error objects with built-in handler", () => {
    const testError = new Error("Test error")
    testError.name = "CustomError"
    testError.stack = "Error: Test error\n    at test"

    const [wireValue, transfers] = toWireValue(testError)

    expect(wireValue).toEqual({
      type: "handler",
      name: "error",
      value: {
        name: "CustomError",
        message: "Test error",
        stack: "Error: Test error\n    at test"
      }
    })
    expect(transfers).toEqual([])

    // Test deserialization
    const deserialized = fromWireValue(wireValue)
    expect(deserialized).toBeInstanceOf(Error)
    expect((deserialized as Error).name).toBe("CustomError")
    expect((deserialized as Error).message).toBe("Test error")
  })

  it("should handle regular objects without transfer handlers", () => {
    const testObj = { name: "test", value: 42, nested: { prop: "value" } }

    const [wireValue, transfers] = toWireValue(testObj)

    expect(wireValue).toEqual({
      type: "raw",
      value: testObj
    })
    expect(transfers).toEqual([])

    // Test deserialization
    const deserialized = fromWireValue(wireValue)
    expect(deserialized).toEqual(testObj)
  })

  it("should handle transfer marking", () => {
    const testObj = { name: "test" }
    const transferables = [new Uint8Array([1, 2, 3])]

    // Mark object for transfer
    const markedObj = transfer(testObj, transferables)

    const [wireValue, transfers] = toWireValue(markedObj)

    expect(wireValue).toEqual({
      type: "raw",
      value: testObj
    })
    expect(transfers).toEqual(transferables)
  })

  it("should serialize and deserialize messages with transfer handlers", async () => {
    // Register a custom handler for testing
    const testHandler: TransferHandler<{ custom: string }, { serialized: string }> = {
      canHandle: (value): value is { custom: string } => 
        typeof value === 'object' && value !== null && 'custom' in value,
      serialize: (obj) => ({ serialized: `custom:${obj.custom}` }),
      deserialize: (data) => ({ custom: data.serialized.substring(7) }) // Remove "custom:" prefix
    }
    transferHandlers.set("test", testHandler)

    const message = {
      id: "test-id",
      method: "testMethod",
      args: [{ custom: "value" }, "regular string"],
      type: "request" as const
    }

    const { data: serialized, transfers } = serializeMessage(message)
    
    // Verify that message was serialized with transfer handlers
    expect(serialized).toContain('"type":"handler"')
    expect(serialized).toContain('"name":"test"')
    expect(transfers).toEqual([])

    // Deserialize and verify
    const deserialized = await deserializeMessage(serialized)
    expect(deserialized.args).toEqual([{ custom: "value" }, "regular string"])
  })
})