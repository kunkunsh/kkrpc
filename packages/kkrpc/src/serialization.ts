/**
 * Compatibility exports for kkrpc's full serialization runtime.
 * Existing users import protocol types and helpers from this path, so it remains
 * SuperJSON-enabled. Browser-lite must import `serialization-json.ts` or
 * `serialization-types.ts` directly instead of this barrel.
 */

export * from "./serialization-types.ts"
export * from "./serialization-full.ts"
