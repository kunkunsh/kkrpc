import { expect, test, describe } from "bun:test"
import { RPCChannel, WorkerParentIO, transfer, type DestroyableIoInterface } from "../mod.ts"
import { apiMethods, type API } from "./scripts/api.ts"

function createRpc() {
	const worker = new Worker(new URL("./scripts/worker.ts", import.meta.url).href, { type: "module" })
	const io = new WorkerParentIO(worker)
	const rpc = new RPCChannel<API, API, DestroyableIoInterface>(io, { expose: apiMethods })
	const api = rpc.getAPI()
	return { worker, io, rpc, api }
}

describe("Transfer Bug Test", () => {
    test("object with multiple transferables corrupts subsequent transfers", async () => {
        const { io, api } = createRpc()

        // An object with two buffers that we want to transfer.
        const buf1 = new Uint8Array(8).fill(1)
        const buf2 = new Uint8Array(16).fill(2)
        const num = 42;

        const multiTransferObj = {
            buf1: buf1.buffer,
            buf2: buf2.buffer,
            c: num,
        }

        // We expect this call to fail because of the bug.
        // The bug is that the serialization logic doesn't handle multiple transferables for a single object correctly.
        // It will likely only transfer the first buffer and misalign the transfer queue.
        const multiTransferResult = await api.processMultiTransfer(transfer(multiTransferObj, [buf1.buffer, buf2.buffer]))

        // These assertions will fail if the bug is present.
        // `buf2` will likely not be transferred correctly, so its byteLength will be wrong.
        expect(multiTransferResult.b1).toBe(8)
        expect(multiTransferResult.b2).toBe(16)
        expect(multiTransferResult.c).toBe(42)

        // This second call is to demonstrate that the transfer queue is corrupted.
        const buf3 = new Uint8Array(32).fill(3)
        const singleTransferResult = await api.processBuffer(transfer(buf3.buffer, [buf3.buffer]))

        // This assertion will fail if the previous call corrupted the transfer state.
        // The `processBuffer` method will receive the wrong buffer (`buf2` instead of `buf3`).
        expect(singleTransferResult).toBe(32)

        io.destroy()
    }, {
        // This test is expected to fail until the bug is fixed.
        // For now, we'll let it fail to demonstrate the bug.
    })
})
