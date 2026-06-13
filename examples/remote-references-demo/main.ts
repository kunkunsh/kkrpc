/**
 * Main-thread side of the remote references demo.
 *
 * Imports from `kkrpc/remote-refs` because the demo relies on callback return
 * values and long-lived object handles, both of which are opt-in in v0.2.0.
 * @module
 */

import { proxy, releaseProxy, wrap } from "kkrpc/remote-refs"
import { workerTransport } from "kkrpc/worker"

interface ToastHandle {
	hide(): Promise<string>
}

interface CounterHandle {
	value: Promise<number>
	increment(amount: number): Promise<number>
}

interface DemoAPI {
	createToast(message: string): Promise<ToastHandle>
	useCallback(callback: (value: string) => Promise<string>): Promise<string>
	createCounter(): Promise<CounterHandle>
}

const worker = new Worker(new URL("./worker.ts", import.meta.url).href, { type: "module" })
const api = wrap<DemoAPI>(workerTransport(worker))

try {
	const toast = await api.createToast("hello")
	console.log(await toast.hide())

	const callbackResult = await api.useCallback(proxy(async (value) => `callback:${value}`))
	console.log(callbackResult)

	const counter = await api.createCounter()
	console.log(await counter.value)
	console.log(await counter.increment(5))
	await releaseProxy(counter)
	await releaseProxy(toast.hide)
} finally {
	worker.terminate()
}
