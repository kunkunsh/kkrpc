/**
 * @module @kunkun/kkrpc/browser-mini
 * @description Compact browser-only RPC entrypoint for worker structured-clone transports.
 */

export {
	RPCChannel,
	type MiniMessage,
	type MiniTransport,
	type RPCChannelOptions
} from "./src/browser-mini/channel.ts"
export { WorkerChildIO, WorkerParentIO } from "./src/browser-mini/worker.ts"
export { transfer, type TransferDescriptor } from "./src/transfer.ts"
