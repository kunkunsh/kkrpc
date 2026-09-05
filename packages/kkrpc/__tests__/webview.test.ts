import { describe, expect, test } from "bun:test"
import { RPCChannel } from "../src/entries/mod.ts"
import {
	hasWebViewHost,
	webViewPlatform,
	webViewTransport,
	type WebViewHostWindow
} from "../src/transports/webview.ts"

/** A `WKWebView` host: a named message handler that takes a structured value. */
function webKitWindow(name: string) {
	const received: unknown[] = []
	const windowLike = {
		webkit: { messageHandlers: { [name]: { postMessage: (body: unknown) => received.push(body) } } }
	} as unknown as WebViewHostWindow
	return { windowLike, received }
}

/** An Android / HarmonyOS host: an injected object that only takes a string. */
function injectedWindow(name: string) {
	const received: string[] = []
	const windowLike = {
		[name]: { postMessage: (json: string) => received.push(json) }
	} as unknown as WebViewHostWindow
	return { windowLike, received }
}

/** A WebView2 host: `chrome.webview`, structured. */
function webView2Window() {
	const received: unknown[] = []
	const windowLike = {
		chrome: { webview: { postMessage: (body: unknown) => received.push(body) } }
	} as unknown as WebViewHostWindow
	return { windowLike, received }
}

describe("native WebView transport", () => {
	test("sends a structured value to a WebKit handler and a string to an injected object", () => {
		const webKit = webKitWindow("surface")
		webViewPlatform({ channelName: "surface", windowLike: webKit.windowLike }).send(
			'{"a":1}'
		)
		expect(webKit.received).toEqual([{ a: 1 }])

		const android = injectedWindow("surface")
		webViewPlatform({ channelName: "surface", windowLike: android.windowLike }).send('{"a":1}')
		expect(android.received).toEqual(['{"a":1}'])
	})

	test("WebView2 is reached through chrome.webview", () => {
		const host = webView2Window()
		webViewPlatform({ channelName: "surface", windowLike: host.windowLike }).send('{"a":1}')
		expect(host.received).toEqual([{ a: 1 }])
	})

	test("the host's inbound hook is installed under a name a second surface cannot collide with", () => {
		const host = webKitWindow("surface")
		const platform = webViewPlatform({ channelName: "surface", windowLike: host.windowLike })
		const seen: string[] = []
		platform.subscribe((wire) => seen.push(wire))

		const receive = (host.windowLike as Record<string, unknown>).__kkrpc_surface as (
			frame: unknown
		) => void
		expect(typeof receive).toBe("function")

		// A host may push either a JSON string or an already-parsed object; WebKit's
		// `evaluateJavaScript` makes the second one natural and the first one safer.
		receive('{"from":"host"}')
		receive({ from: "host" })
		expect(seen).toEqual(['{"from":"host"}', '{"from":"host"}'])

		platform.close?.()
		expect((host.windowLike as Record<string, unknown>).__kkrpc_surface).toBeUndefined()
	})

	test("a page with no host sends into a silent sink rather than throwing", () => {
		// `vite dev` in a plain browser. Throwing here would make a surface that is
		// otherwise perfectly renderable impossible to develop.
		const windowLike = {} as WebViewHostWindow
		expect(() =>
			webViewPlatform({ channelName: "surface", windowLike }).send('{"a":1}')
		).not.toThrow()
		expect(hasWebViewHost({ channelName: "surface", windowLike })).toBe(false)
		expect(
			hasWebViewHost({ channelName: "surface", windowLike: webKitWindow("surface").windowLike })
		).toBe(true)
	})

	test("a malformed frame is dropped instead of taking the channel down", () => {
		const host = webKitWindow("surface")
		const transport = webViewTransport({ channelName: "surface", windowLike: host.windowLike })
		const seen: unknown[] = []
		transport.subscribe((message) => seen.push(message))

		const receive = (host.windowLike as Record<string, unknown>).__kkrpc_surface as (
			frame: unknown
		) => void
		// The inbound hook is a public global: anything on the page can call it.
		expect(() => receive("not json at all")).not.toThrow()
		expect(seen).toEqual([])

		receive('{"t":"r","id":"1","v":null}')
		expect(seen.length).toBe(1)
	})

	test("two surfaces in one application do not share an inbound hook", () => {
		const host = webKitWindow("editor")
		;(host.windowLike as { webkit: { messageHandlers: Record<string, unknown> } }).webkit
			.messageHandlers.terminal = { postMessage: () => {} }

		webViewPlatform({ channelName: "editor", windowLike: host.windowLike })
		webViewPlatform({ channelName: "terminal", windowLike: host.windowLike })

		const record = host.windowLike as Record<string, unknown>
		expect(typeof record.__kkrpc_editor).toBe("function")
		expect(typeof record.__kkrpc_terminal).toBe("function")
		expect(record.__kkrpc_editor).not.toBe(record.__kkrpc_terminal)
	})

	test("a call made through the channel reaches the host as one JSON frame", async () => {
		const host = webKitWindow("surface")
		const channel = new RPCChannel<Record<string, never>, { ping(value: number): number }>(
			webViewTransport({ channelName: "surface", windowLike: host.windowLike })
		)
		const api = channel.getAPI()
		const pending = api.ping(41)

		// One frame out, carrying the operation, the path and the argument.
		expect(host.received.length).toBe(1)
		const sent = host.received[0] as { t?: string; op?: string; p?: string[]; a?: unknown[]; id?: string }
		expect(sent.t).toBe("q")
		expect(sent.op).toBe("call")
		expect(sent.p).toEqual(["ping"])
		// The argument travels in kkrpc's value envelope rather than bare, which is
		// what lets a callback argument be told apart from a value.
		expect(sent.a?.length).toBe(1)
		expect(JSON.stringify(sent.a?.[0])).toContain("41")

		const receive = (host.windowLike as Record<string, unknown>).__kkrpc_surface as (
			frame: unknown
		) => void
		receive({ t: "r", id: sent.id, v: 42 })
		expect(await pending).toBe(42)
	})
})
