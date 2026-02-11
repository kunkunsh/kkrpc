/**
 * kkrpc Inspector - Traffic inspection and debugging utilities
 *
 * Provides a pluggable system for inspecting RPC traffic across all adapters.
 * Supports multiple backends: console, file, memory, WebSocket.
 */

import type { IoInterface, IoMessage } from "../interface.ts"
import type { Message } from "../serialization.ts"

/**
 * Event representing a single RPC message inspection point
 */
export interface InspectEvent {
	/** Timestamp in milliseconds (Date.now()) */
	timestamp: number
	/** Direction of message flow */
	direction: "sent" | "received"
	/** Session identifier for correlating related traffic */
	sessionId: string
	/** The RPC message content */
	message: Message
	/** Size of raw message in bytes (if available) */
	rawSize?: number
	/** Duration in ms (for responses, calculated from corresponding request) */
	duration?: number
}

/**
 * Backend interface for processing inspection events
 */
export interface InspectorBackend {
	/** Process a single inspection event */
	log(event: InspectEvent): void
	/** Optional flush for batching backends */
	flush?(): Promise<void>
	/** Optional cleanup */
	destroy?(): void
}

/**
 * Options for configuring the inspector
 */
export interface InspectorOptions {
	/** Filter which messages to log */
	filter?: (msg: Message) => boolean
	/** Sanitize sensitive data from messages */
	sanitize?: (msg: Message) => Message
	/** Enable request/response correlation for latency tracking */
	trackLatency?: boolean
}

/**
 * Event with latency tracking metadata
 */
export interface TrackedInspectEvent extends InspectEvent {
	/** Latency in milliseconds (for responses) */
	latency?: number
}

/**
 * Statistics tracked by the inspector
 */
export interface InspectorStats {
	/** Total messages logged */
	totalMessages: number
	/** Messages sent */
	sent: number
	/** Messages received */
	received: number
	/** Errors encountered */
	errors: number
	/** Average latency (if tracking enabled) */
	avgLatency?: number
	/** Method call counts */
	methodCounts: Map<string, number>
}
