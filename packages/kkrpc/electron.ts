/**
 * Electron RPC Module
 *
 * This module provides Electron utility process adapters for kkrpc,
 * enabling bidirectional RPC communication between Electron's main process
 * and utility processes via postMessage.
 *
 * @example
 * ```typescript
 * // Main process
 * import { utilityProcess } from 'electron'
 * import { ElectronUtilityProcessIO, RPCChannel } from 'kkrpc/electron'
 *
 * const child = utilityProcess.fork('./utility-script.js')
 * const io = new ElectronUtilityProcessIO(child)
 * const rpc = new RPCChannel(io, { expose: mainAPI })
 * const workerAPI = rpc.getAPI<WorkerAPI>()
 * ```
 *
 * @example
 * ```typescript
 * // Utility process (child)
 * import { ElectronUtilityProcessChildIO, RPCChannel } from 'kkrpc/electron'
 *
 * const io = new ElectronUtilityProcessChildIO()
 * const rpc = new RPCChannel(io, { expose: workerAPI })
 * const mainAPI = rpc.getAPI<MainAPI>()
 * ```
 */

export * from "./src/adapters/electron.ts"
export * from "./src/adapters/electron-child.ts"
export * from "./src/channel.ts"
export * from "./src/utils.ts"
export * from "./src/serialization.ts"
export * from "./src/interface.ts"

export { ElectronUtilityProcessChildIO } from "./src/adapters/electron-child.ts"

export { ElectronUtilityProcessChildIO as ElectronParentPortIO } from "./src/adapters/electron-child.ts"
