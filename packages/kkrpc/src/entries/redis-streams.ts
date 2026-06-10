/**
 * Published `kkrpc/redis-streams` entry for Redis Streams transports.
 *
 * Import this entry in Node.js or compatible runtimes that have `ioredis`
 * installed and need kkrpc over a Redis stream.
 * @module
 */
export {
	redisStreamsTransport,
	type RedisStreamsTransport,
	type RedisStreamsTransportOptions
} from "../transports/redis-streams.ts"
