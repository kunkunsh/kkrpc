/**
 * Worker side of the remote references demo.
 *
 * Returned function leaves and class instances are explicitly wrapped in
 * `proxy()` so they cross the Worker boundary by reference instead of by value.
 * @module
 */

import { expose, proxy, releaseProxy } from "kkrpc/remote-refs"
import { workerSelfTransport } from "kkrpc/worker"

class CounterHandle {
	value = 0

	increment(amount: number) {
		this.value += amount
		return this.value
	}
}

const api = {
	createToast(message: string) {
		return {
			hide: proxy(async () => `hidden:${message}`)
		}
	},

	async useCallback(callback: (value: string) => Promise<string>) {
		try {
			return await callback("from-worker")
		} finally {
			await releaseProxy(callback)
		}
	},

	createCounter() {
		return proxy(new CounterHandle())
	}
}

expose(api, workerSelfTransport())
