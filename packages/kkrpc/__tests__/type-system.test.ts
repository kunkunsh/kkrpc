/**
 * Compile-time and runtime validation tests for Remote<T> and callback constraints.
 * @module
 */

import { describe, expect, test } from "bun:test"
import type {
	BiDirectionalCallbackError,
	HttpCallbackError,
	OneWayCallbackError,
	Remote,
	RemoteProperty,
	ValidateBiDirectionalAPI,
	ValidateHttpAPI,
	ValidateOneWayAPI
} from "../src/core/types.ts"

// Type assertion helpers
type Expect<T extends true> = T
type Equal<X, Y> =
	(<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

describe("Remote<T> automatic promisification", () => {
	test("promisifies synchronous methods and leaves existing Promises unchanged", () => {
		type LocalAPI = {
			syncAdd(a: number, b: number): number
			asyncGreet(name: string): Promise<string>
			syncVoid(): void
			asyncVoid(): Promise<void>
		}

		type RemoteAPI = Remote<LocalAPI>

		type _testSyncAdd = Expect<Equal<ReturnType<RemoteAPI["syncAdd"]>, Promise<number>>>
		type _testAsyncGreet = Expect<Equal<ReturnType<RemoteAPI["asyncGreet"]>, Promise<string>>>
		type _testSyncVoid = Expect<Equal<ReturnType<RemoteAPI["syncVoid"]>, Promise<void>>>
		type _testAsyncVoid = Expect<Equal<ReturnType<RemoteAPI["asyncVoid"]>, Promise<void>>>
	})

	test("preserves AsyncIterable for streaming methods", () => {
		type LocalAPI = {
			numbers(count: number): AsyncIterable<number>
		}

		type RemoteAPI = Remote<LocalAPI>

		type _testStream = Expect<Equal<ReturnType<RemoteAPI["numbers"]>, AsyncIterable<number>>>
	})

	test("preserves nested object hierarchy while promisifying leaf methods and properties", () => {
		type LocalAPI = {
			math: {
				factor: number
				add(a: number, b: number): number
			}
			config: {
				nested: {
					flag: boolean
				}
			}
		}

		type RemoteAPI = Remote<LocalAPI>

		// math itself is an object, not wrapped in Promise
		type _testMathAdd = Expect<Equal<ReturnType<RemoteAPI["math"]["add"]>, Promise<number>>>
		// Leaf property is readonly RemoteProperty<T>
		type _testMathFactor = Expect<Equal<RemoteAPI["math"]["factor"], RemoteProperty<number>>>
		type _testConfigFlag = Expect<
			Equal<RemoteAPI["config"]["nested"]["flag"], RemoteProperty<boolean>>
		>
	})

	test("promisifies constructor signatures", () => {
		type LocalAPI = {
			Widget: new (name: string) => { name: string; run(): void }
		}

		type RemoteAPI = Remote<LocalAPI>

		type RemoteWidgetConstructor = RemoteAPI["Widget"]
		type Instance = InstanceType<RemoteWidgetConstructor>

		type _testConstructorReturn = Expect<
			Instance extends Promise<{ name: string; run: () => Promise<void> }> ? true : false
		>
	})
})

describe("One-way expose API callback constraints", () => {
	test("accepts callbacks returning void or undefined", () => {
		type ValidAPI = {
			run(cb: (n: number) => void): void
			process(opts: { onProgress: (percent: number) => void }): void
		}

		type Validated = ValidateOneWayAPI<ValidAPI>
		type _testValid = Expect<Equal<Validated, ValidAPI>>
	})

	test("rejects callbacks returning non-void types", () => {
		type InvalidAPI = {
			run(cb: (n: number) => string): void
			process(opts: { onProgress: (percent: number) => Promise<string> }): void
		}

		type Validated = ValidateOneWayAPI<InvalidAPI>

		type Callback1Return = ReturnType<Parameters<Validated["run"]>[0]>
		type _testInvalid1 = Expect<Equal<Callback1Return, OneWayCallbackError>>

		type Callback2Return = ReturnType<Parameters<Validated["process"]>[0]["onProgress"]>
		type _testInvalid2 = Expect<Equal<Callback2Return, OneWayCallbackError>>
	})
})

describe("Bidirectional expose API callback constraints", () => {
	test("accepts callbacks returning Promise<any> or void", () => {
		type ValidAPI = {
			compute(cb: (n: number) => Promise<string>): void
			notify(cb: () => void): void
			nested(opts: { onDone: (res: boolean) => Promise<void> }): void
		}

		type Validated = ValidateBiDirectionalAPI<ValidAPI>
		type _testValid = Expect<Equal<Validated, ValidAPI>>
	})

	test("rejects callbacks returning synchronous non-void types", () => {
		type InvalidAPI = {
			compute(cb: (n: number) => string): void
			nested(opts: { transform: (x: number) => number }): void
		}

		type Validated = ValidateBiDirectionalAPI<InvalidAPI>

		type Callback1Return = ReturnType<Parameters<Validated["compute"]>[0]>
		type _testInvalid1 = Expect<Equal<Callback1Return, BiDirectionalCallbackError>>

		type Callback2Return = ReturnType<Parameters<Validated["nested"]>[0]["transform"]>
		type _testInvalid2 = Expect<Equal<Callback2Return, BiDirectionalCallbackError>>
	})
})

describe("HTTP expose API constraints", () => {
	test("rejects any callbacks in parameters or options", () => {
		type InvalidAPI = {
			run(cb: () => void): void
			process(opts: { onProgress: () => void }): void
		}

		type Validated = ValidateHttpAPI<InvalidAPI>

		type Param1 = Parameters<Validated["run"]>[0]
		type _testHttp1 = Expect<Equal<Param1, HttpCallbackError>>

		type OptsCallback = Parameters<Validated["process"]>[0]["onProgress"]
		type _testHttp2 = Expect<Equal<OptsCallback, HttpCallbackError>>
	})
})

describe("Runtime integration with Remote<T> and expose constraints", () => {
	test("wrap automatically promisifies methods on the client proxy", async () => {
		const syncAPI = {
			add(a: number, b: number) {
				return a + b
			},
			echo(msg: string) {
				return msg
			},
			counter: 10
		}

		type SyncAPI = typeof syncAPI

		// Memory pair
		const aListeners = new Set<(m: any) => void>()
		const bListeners = new Set<(m: any) => void>()

		const transportA = {
			send: (msg: any) => queueMicrotask(() => bListeners.forEach((l) => l(msg))),
			subscribe: (l: any) => {
				aListeners.add(l)
				return () => aListeners.delete(l)
			}
		}
		const transportB = {
			send: (msg: any) => queueMicrotask(() => aListeners.forEach((l) => l(msg))),
			subscribe: (l: any) => {
				bListeners.add(l)
				return () => bListeners.delete(l)
			}
		}

		const { RPCChannel } = await import("../src/entries/mod.ts")
		const server = new RPCChannel(transportB, { expose: syncAPI })
		const client = new RPCChannel<object, SyncAPI>(transportA)

		const remote = client.getAPI()

		// Remote methods are automatically Promise-returning
		const sum: Promise<number> = remote.add(5, 7)
		expect(await sum).toBe(12)

		const echoResult: Promise<string> = remote.echo("hello")
		expect(await echoResult).toBe("hello")

		const counterVal: Promise<number> = remote.counter
		expect(await counterVal).toBe(10)

		// Test set on remote property
		await remote.counter.set(25)
		expect(await remote.counter).toBe(25)
		expect(syncAPI.counter).toBe(25)

		client.destroy()
		server.destroy()
	})

	test("recursively promisifies function leaves and closures returned from methods", async () => {
		type ToastHandle = {
			message: string
			hide(): string // synchronous method in local implementation
		}

		type LocalAPI = {
			createToast(msg: string): ToastHandle
			createCalculator(base: number): (multiplier: number) => number
			nestedHigherOrder(): () => () => string
		}

		type RemoteAPI = Remote<LocalAPI>

		// 1. Returned object's data property stays plain data (not Promise),
		// while its method is automatically promisified:
		type ToastReturn = Awaited<ReturnType<RemoteAPI["createToast"]>>
		type _testToastMessage = Expect<Equal<ToastReturn["message"], string>>
		type _testToastHide = Expect<Equal<ReturnType<ToastReturn["hide"]>, Promise<string>>>

		// 2. Returned closure is automatically promisified:
		type CalculatorClosure = Awaited<ReturnType<RemoteAPI["createCalculator"]>>
		type _testCalculatorReturn = Expect<Equal<ReturnType<CalculatorClosure>, Promise<number>>>

		// 3. Multi-level nested closures are recursively promisified:
		type HigherOrderL1 = Awaited<ReturnType<RemoteAPI["nestedHigherOrder"]>>
		type HigherOrderL2 = Awaited<ReturnType<HigherOrderL1>>
		type _testHigherOrderL2 = Expect<Equal<ReturnType<HigherOrderL2>, Promise<string>>>
	})

	test("runtime bidirectional expose with returned proxy closure and method leaves", async () => {
		const { RPCChannel, proxy } = await import("../src/entries/remote-refs.ts")

		const serverAPI = {
			createToast(msg: string) {
				return {
					message: msg,
					// function leaf wrapped with proxy()
					hide: proxy(() => `hidden:${msg}`)
				}
			},
			createMultiplier(factor: number) {
				// closure function wrapped with proxy()
				return proxy((val: number) => val * factor)
			}
		}

		type ServerAPI = typeof serverAPI

		const aListeners = new Set<(m: any) => void>()
		const bListeners = new Set<(m: any) => void>()

		const transportA = {
			capabilities: { objectMode: true, transfer: true, remoteRefs: true },
			send: (msg: any) => queueMicrotask(() => bListeners.forEach((l) => l(msg))),
			subscribe: (l: any) => {
				aListeners.add(l)
				return () => aListeners.delete(l)
			}
		}
		const transportB = {
			capabilities: { objectMode: true, transfer: true, remoteRefs: true },
			send: (msg: any) => queueMicrotask(() => aListeners.forEach((l) => l(msg))),
			subscribe: (l: any) => {
				bListeners.add(l)
				return () => bListeners.delete(l)
			}
		}

		const server = new RPCChannel(transportB, { expose: serverAPI })
		const client = new RPCChannel<object, ServerAPI>(transportA)

		const remote = client.getAPI()

		// 1. Toast object test: message is sync string, hide() returns Promise<string>
		const toast = await remote.createToast("hello-toast")
		expect(toast.message).toBe("hello-toast")
		const hideResult: Promise<string> = toast.hide()
		expect(await hideResult).toBe("hidden:hello-toast")

		// 2. Closure function test: multiplier is (val: number) => Promise<number>
		const multiply = await remote.createMultiplier(3)
		const multResult: Promise<number> = multiply(7)
		expect(await multResult).toBe(21)

		client.destroy()
		server.destroy()
	})
})
