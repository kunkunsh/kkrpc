/**
 * Chrome Extension RPC Module
 *
 * This module provides comprehensive Chrome extension adapters for kkrpc,
 * including both basic and enhanced adapters with utility functions.
 *
 * @example
 * ```typescript
 * import { setupBackgroundRPC, setupContentRPC } from 'kkrpc/chrome-extension'
 *
 * // Background script
 * const rpcChannels = setupBackgroundRPC(backgroundAPI)
 *
 * // Content script
 * const { rpc, backgroundAPI } = setupContentRPC(contentAPI)
 * ```
 */

export * from "./src/adapters/chrome-extension.ts"
export * from "./src/channel.ts"
export * from "./src/utils.ts"
export * from "./src/serialization.ts"
export * from "./src/interface.ts"
