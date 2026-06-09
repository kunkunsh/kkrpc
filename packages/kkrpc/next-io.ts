/**
 * Optional migration bridge from classic IoInterface adapters to kkrpc/next.
 *
 * Prefer native vNext transports for new code. Use this entry only when
 * incrementally migrating an existing classic adapter instance.
 */

export * from "./src/next/io.ts"
