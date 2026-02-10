/**
 * @module @kunkun/kkrpc/browser
 * @description This module contains browser-only modules, other modules don't work in browser.
 */
export * from "./src/adapters/worker.ts"
export * from "./src/adapters/iframe.ts"
export * from "./src/adapters/websocket.ts"
export * from "./src/adapters/tauri.ts"
export * from "./src/interface.ts"
export * from "./src/channel.ts"
export * from "./src/utils.ts"
export * from "./src/serialization.ts"
export * from "./src/transfer.ts"
export * from "./src/transfer-handlers.ts"
export * from "./src/standard-schema.ts"
export * from "./src/validation.ts"
export * from "./src/middleware.ts"
