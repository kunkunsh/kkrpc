import { io, type Socket } from "socket.io-client"
import { type Socket as ServerSocket } from "socket.io"
import type { DestroyableIoInterface } from "../interface.ts"

// Special signal used to indicate that the connection should be destroyed
const DESTROY_SIGNAL = "__DESTROY__"

// Extended options interface with proper typing
interface SocketIOClientOptions {
	url: string // Socket.IO server URL (e.g., "http://localhost:3000")
	namespace?: string // Optional Socket.IO namespace (e.g., "chat")
	opts?: import("socket.io-client").SocketOptions // Socket.IO client options with proper typing
}

/**
 * Socket.IO Client implementation of IoInterface
 *
 * This class provides the client-side implementation for communicating with a Socket.IO server.
 * It implements the DestroyableIoInterface to provide read/write capabilities and cleanup functionality.
 *
 * Usage:
 * ```ts
 * const clientIO = new SocketIOClientIO({
 *   url: "http://localhost:3000",
 *   namespace: "rpc"
 * })
 * const rpc = new RPCChannel(clientIO, { expose: apiImplementation })
 * ```
 */
export class SocketIOClientIO implements DestroyableIoInterface {
	name = "socketio-client-io"

	// Queue to store incoming messages when no reader is waiting
	private messageQueue: string[] = []

	// Resolve function for the current read() promise - allows us to resolve reads when messages arrive
	private resolveRead: ((value: string | null) => void) | null = null

	// The underlying Socket.IO client socket instance
	private socket: Socket // Properly typed Socket.IO client socket

	// Promise that resolves when the socket connects - ensures we don't try to write before connection
	private connected: Promise<void>

	// Resolve function for the connected promise - called when socket connects
	private connectResolve: (() => void) | null = null

	constructor(private options: SocketIOClientOptions) {
		// Construct the full URL including namespace if provided
		// Socket.IO namespace URLs are in format: http://server:port/namespace
		const url = this.options.namespace
			? `${this.options.url}/${this.options.namespace}`
			: this.options.url

		// Create Socket.IO client instance with provided options
		this.socket = io(url, this.options.opts)

		// Create a promise that will resolve when the socket connects
		// This prevents write operations from executing before the connection is established
		this.connected = new Promise((resolve) => {
			this.connectResolve = resolve
		})

		// Set up event listeners for the socket connection

		// When the socket connects, resolve the connected promise
		// This signals that we can start sending messages
		this.socket.on("connect", () => {
			this.connectResolve?.()
		})

		// Handle incoming messages from the server
		this.socket.on("message", (message: string) => {
			// Check if this is a destroy signal - special case for cleanup
			if (message === DESTROY_SIGNAL) {
				this.destroy()
				return
			}

			// If someone is waiting for a message (resolveRead is set), deliver it immediately
			if (this.resolveRead) {
				this.resolveRead(message)
				this.resolveRead = null // Clear the resolve function
			} else {
				// No one is waiting, so queue the message for later
				this.messageQueue.push(message)
			}
		})

		// Handle socket disconnection
		// When disconnected, any pending read should resolve with null to signal end of stream
		this.socket.on("disconnect", () => {
			if (this.resolveRead) {
				this.resolveRead(null)
				this.resolveRead = null
			}
		})

		// Handle socket errors - log them for debugging
		this.socket.on("error", (error: Error) => {
			console.error("Socket.IO error:", error)
		})
	}

	/**
	 * Read a message from the socket
	 *
	 * This method implements the async read interface expected by RPCChannel.
	 * It will return queued messages immediately or wait for new messages to arrive.
	 *
	 * @returns Promise that resolves with the message string, or null if disconnected
	 */
	async read(): Promise<string | null> {
		// Wait for socket to connect before attempting to read
		// This ensures we don't try to read from a disconnected socket
		await this.connected

		// If there are queued messages, return the oldest one (FIFO order)
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		// No queued messages, so create a new promise that will resolve
		// when the next message arrives. Store the resolve function
		// so the message listener can call it.
		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	/**
	 * Write a message to the socket
	 *
	 * This method implements the async write interface expected by RPCChannel.
	 * It ensures the socket is connected before sending the message.
	 *
	 * @param data The message string to send to the server
	 */
	async write(data: string): Promise<void> {
		// Wait for socket to connect before attempting to write
		// This prevents errors from trying to write to a disconnected socket
		await this.connected

		// Send the message to the server using Socket.IO's emit method
		this.socket.emit("message", data)
	}

	/**
	 * Clean up resources and disconnect the socket
	 *
	 * This method implements the destroy interface from DestroyableIoInterface.
	 * It should be called when the RPC channel is no longer needed.
	 */
	destroy(): void {
		if (this.socket) {
			// Disconnect the socket - this will trigger the 'disconnect' event
			this.socket.disconnect()
		}
	}

	/**
	 * Signal to the remote end that this connection should be destroyed
	 *
	 * This sends the special destroy signal to the remote side, causing it
	 * to call its destroy() method as well.
	 */
	signalDestroy(): void {
		// Send the destroy signal as a regular message
		// The remote side will recognize this special signal and destroy itself
		this.write(DESTROY_SIGNAL)
	}
}

/**
 * Socket.IO Server implementation of IoInterface
 *
 * This class provides the server-side implementation for communicating with a Socket.IO client.
 * It's used when creating RPC servers that listen for incoming Socket.IO connections.
 *
 * Usage:
 * ```ts
 * io.on('connection', (socket) => {
 *   const serverIO = new SocketIOServerIO(socket)
 *   const rpc = new RPCChannel(serverIO, { expose: serverAPI })
 * })
 * ```
 */
export class SocketIOServerIO implements DestroyableIoInterface {
	name = "socketio-server-io"

	// Queue to store incoming messages when no reader is waiting
	private messageQueue: string[] = []

	// Resolve function for the current read() promise - allows us to resolve reads when messages arrive
	private resolveRead: ((value: string | null) => void) | null = null

	// The Socket.IO server socket instance (already connected when passed to constructor)
	private socket: ServerSocket // Properly typed Socket.IO server socket

	/**
	 * Create a new SocketIOServerIO instance
	 *
	 * @param socket An already connected Socket.IO server socket instance
	 *               This socket should have already completed the connection handshake
	 */
	constructor(socket: ServerSocket) {
		this.socket = socket

		// Set up event listeners for the socket connection

		// Handle incoming messages from the client
		this.socket.on("message", (message: string) => {
			// Check if this is a destroy signal - special case for cleanup
			if (message === DESTROY_SIGNAL) {
				this.destroy()
				return
			}

			// If someone is waiting for a message (resolveRead is set), deliver it immediately
			if (this.resolveRead) {
				this.resolveRead(message)
				this.resolveRead = null // Clear the resolve function
			} else {
				// No one is waiting, so queue the message for later
				this.messageQueue.push(message)
			}
		})

		// Handle client disconnection
		// When client disconnects, any pending read should resolve with null to signal end of stream
		this.socket.on("disconnect", () => {
			if (this.resolveRead) {
				this.resolveRead(null)
				this.resolveRead = null
			}
		})

		// Handle socket errors - log them for debugging
		this.socket.on("error", (error: Error) => {
			console.error("Socket.IO error:", error)
		})
	}

	/**
	 * Read a message from the client socket
	 *
	 * This method implements the async read interface expected by RPCChannel.
	 * Unlike the client version, no connection waiting is needed since the socket
	 * is already connected when passed to the constructor.
	 *
	 * @returns Promise that resolves with the message string, or null if disconnected
	 */
	async read(): Promise<string | null> {
		// If there are queued messages, return the oldest one (FIFO order)
		if (this.messageQueue.length > 0) {
			return this.messageQueue.shift() ?? null
		}

		// No queued messages, so create a new promise that will resolve
		// when the next message arrives. Store the resolve function
		// so the message listener can call it.
		return new Promise((resolve) => {
			this.resolveRead = resolve
		})
	}

	/**
	 * Write a message to the client socket
	 *
	 * This method implements the async write interface expected by RPCChannel.
	 * Since the socket is already connected, we can emit immediately.
	 *
	 * @param data The message string to send to the client
	 */
	async write(data: string): Promise<void> {
		// Send the message to the client using Socket.IO's emit method
		this.socket.emit("message", data)
	}

	/**
	 * Clean up resources and disconnect the socket
	 *
	 * This method implements the destroy interface from DestroyableIoInterface.
	 * It should be called when the RPC channel is no longer needed or when
	 * the client disconnects.
	 */
	destroy(): void {
		if (this.socket) {
			// Disconnect the socket - this will trigger the 'disconnect' event
			this.socket.disconnect()
		}
	}

	/**
	 * Signal to the client that this connection should be destroyed
	 *
	 * This sends the special destroy signal to the client, causing it
	 * to call its destroy() method as well.
	 */
	signalDestroy(): void {
		// Send destroy signal as a regular message
		// The client will recognize this special signal and destroy itself
		this.write(DESTROY_SIGNAL)
	}
}