/**
 * Electron IPC RPC Module
 *
 * This module provides Electron IPC adapters for kkrpc, enabling bidirectional
 * RPC communication between Electron's main process and renderer processes
 * via the ipcMain/ipcRenderer API.
 *
 * @example
 * ```typescript
 * // Main process
 * import { ipcMain, BrowserWindow } from 'electron'
 * import { ElectronIpcMainIO, RPCChannel } from 'kkrpc/electron-ipc'
 *
 * const win = new BrowserWindow({ webPreferences: { preload: 'preload.js' } })
 * const io = new ElectronIpcMainIO(ipcMain, win.webContents)
 * const rpc = new RPCChannel<MainAPI, RendererAPI>(io, { expose: mainAPI })
 * const rendererAPI = rpc.getAPI()
 * ```
 *
 * @example
 * ```typescript
 * // Renderer process
 * import { ElectronIpcRendererIO, RPCChannel } from 'kkrpc/electron-ipc'
 *
 * const io = new ElectronIpcRendererIO()
 * const rpc = new RPCChannel<RendererAPI, MainAPI>(io, { expose: rendererAPI })
 * const mainAPI = rpc.getAPI()
 *
 * // Call main process API directly with type safety
 * const result = await mainAPI.someMethod()
 * ```
 */

export * from "./src/adapters/electron-ipc-main.ts"
export * from "./src/adapters/electron-ipc-renderer.ts"
export * from "./src/channel.ts"
export * from "./src/utils.ts"
export * from "./src/serialization.ts"
export * from "./src/interface.ts"
