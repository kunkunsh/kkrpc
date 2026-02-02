/**
 * TypeScript declarations for Electron utility process API
 *
 * Electron's utility process extends the Node.js process object with a parentPort property
 * for communication with the main process via postMessage.
 *
 * @see https://www.electronjs.org/docs/latest/tutorial/utility-processes
 */

declare global {
	namespace NodeJS {
		interface Process {
			/**
			 * Communication port to the parent process in Electron utility process
			 */
			parentPort?: {
				/**
				 * Send a message to the parent process
				 * @param message - The message to send
				 */
				postMessage(message: any): void
				/**
				 * Register an event listener for messages from parent process
				 * @param event - The event name ("message")
				 * @param listener - The callback function
				 * @returns this for chaining
				 */
				on(event: "message", listener: (event: { data: any }) => void): this
				/**
				 * Remove an event listener for messages from parent process
				 * @param event - The event name ("message")
				 * @param listener - The callback function to remove
				 * @returns this for chaining
				 */
				off(event: "message", listener: (event: { data: any }) => void): this
			}
		}
	}
}

export {}
