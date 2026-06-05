/**
 * @module @kunkun/kkrpc/browser-lite
 * @description Browser-only kkrpc entrypoint that avoids static SuperJSON imports.
 */

export * from "./src/adapters/worker.ts"
export * from "./src/adapters/iframe.ts"
export * from "./src/adapters/websocket.ts"
export * from "./src/adapters/tauri.ts"
export * from "./src/interface.ts"
export * from "./src/channel-lite.ts"
export * from "./src/utils.ts"
export * from "./src/serialization-json.ts"
export * from "./src/serialization-types.ts"
export * from "./src/transfer.ts"
export * from "./src/transfer-handlers.ts"
export * from "./src/standard-schema.ts"
export * from "./src/validation.ts"
export * from "./src/middleware.ts"
