/**
 * @module kkrpc/next/worker
 * @description Object-mode Worker transports for kkrpc/next.
 *
 * Import this entry for Web Worker parent/child communication. It is separate
 * from `kkrpc/next` so non-browser builds do not import Worker globals.
 */
export * from "./src/next/worker.ts"
