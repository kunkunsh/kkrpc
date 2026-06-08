/**
 * @module kkrpc/next/validation
 * @description Optional Standard Schema validation plugin for kkrpc/next.
 *
 * Import this entry only when runtime validation is needed. It keeps schema
 * validation out of the core `kkrpc/next` bundle and composes through the
 * receive-side plugin lifecycle.
 */

export * from "./src/next/validation.ts"
