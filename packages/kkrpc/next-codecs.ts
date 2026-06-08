/**
 * @module kkrpc/next/codecs
 * @description Built-in object, JSON, and JSON-line codecs for kkrpc/next transports.
 *
 * Import this entry when a transport needs lightweight serialization helpers.
 * It intentionally excludes SuperJSON so the default codec path stays small.
 */
export * from "./src/next/codecs.ts"
