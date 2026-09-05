/**
 * Native WebView transport for stable kkrpc.
 *
 * A page rendered inside a host application's WebView — `WKWebView` on Apple
 * platforms, `WebView` on Android and HarmonyOS, `WebView2` on Windows — has a
 * bidirectional channel to that host, but each platform spells both halves
 * differently and none of them is a `MessagePort`, a `WebSocket` or a stream. So
 * the existing transports do not fit: `iframe.ts` needs a window it can hand a
 * port to, `worker.ts` needs a `Worker`, and `stdio.ts` needs a byte stream.
 *
 * What every one of the four *does* have is a one-way string sink from page to
 * host and a global function the host can call to push a string back. That is
 * enough for a JSON-line codec and therefore enough for kkrpc, which is what
 * this file provides:
 *
 * - **Out**: WebKit keys a message *handler*; Android and HarmonyOS inject a
 *   named *object*; WebView2 exposes `chrome.webview`. The differences are
 *   whether the payload is a string or a structured value, and what the thing is
 *   called — both are options here rather than four transports.
 * - **In**: the host evaluates `globalThis[receiveName](json)` in the page. The
 *   name is an option for the same reason a handler name is: two surfaces in one
 *   application must not share one inbound hook.
 *
 * Bidirectional, supports callbacks, does not support transferables — a
 * structured clone cannot cross any of these four boundaries.
 */

import { jsonCodec } from "../core/codecs.ts"
import type { RPCMessage } from "../core/protocol.ts"
import { createTransport, type Platform, type Transport } from "../core/transport.ts"

/** The host-side sinks a page may find on its global object. */
export interface WebViewHostWindow {
	/** Apple: `WKUserContentController.add(_:name:)` keys a handler by name. */
	webkit?: {
		messageHandlers?: Record<string, { postMessage(body: unknown): void }>
	}
	/** Windows: WebView2's `chrome.webview.postMessage`. */
	chrome?: { webview?: { postMessage(body: unknown): void } }
	/** Android `addJavascriptInterface` / HarmonyOS `javaScriptProxy`, by name. */
	[key: string]: unknown
}

/** Options for {@link webViewPlatform} and {@link webViewTransport}. */
export interface WebViewTransportOptions {
	/**
	 * The name the host registered for the page-to-host direction: a WebKit
	 * message handler, or an injected object with a `postMessage` method.
	 */
	channelName: string
	/**
	 * The global function name the host calls to deliver a frame to the page.
	 * Defaults to `` `__kkrpc_${channelName}` ``, which keeps two surfaces in one
	 * application from colliding without either having to name it.
	 */
	receiveName?: string
	/** The global to install on and read the host sinks from. Defaults to `globalThis`. */
	windowLike?: WebViewHostWindow
	/**
	 * Send the raw JSON string rather than a parsed object where the host accepts
	 * structured values. WebKit and WebView2 both accept an object, and passing
	 * one avoids a double encode/decode on the hot path; an injected Android or
	 * HarmonyOS object only accepts a string. Detected per host by default.
	 */
	sendAsString?: boolean
}

/**
 * The wire half: a `Platform<string>` over whichever host sink is present.
 *
 * Returns a platform whose `send` is a no-op when no host is attached, which is
 * the `vite dev` case — a page opened in a plain browser has no host, and
 * throwing there would make development impossible for a surface that is
 * otherwise perfectly renderable.
 */
export function webViewPlatform(options: WebViewTransportOptions): Platform<string> {
	const windowLike = options.windowLike ?? (globalThis as unknown as WebViewHostWindow)
	const receiveName = options.receiveName ?? `__kkrpc_${options.channelName}`
	const listeners = new Set<(wire: string) => void>()

	const webkitHandler = windowLike.webkit?.messageHandlers?.[options.channelName]
	const injected = windowLike[options.channelName] as
		| { postMessage(json: string): void }
		| undefined
	const webview2 = windowLike.chrome?.webview

	const asString =
		options.sendAsString ??
		(injected !== undefined && typeof injected.postMessage === "function" && !webkitHandler)

	const sink: ((json: string) => void) | null = webkitHandler
		? (json) => webkitHandler.postMessage(asString ? json : (JSON.parse(json) as unknown))
		: injected && typeof injected.postMessage === "function"
			? (json) => injected.postMessage(json)
			: webview2
				? (json) => webview2.postMessage(asString ? json : (JSON.parse(json) as unknown))
				: null

	// The host calls this. A frame that arrives before anybody has subscribed is
	// dropped rather than queued: kkrpc's channel subscribes during construction,
	// so anything earlier is a host that started talking before the page loaded,
	// and replaying it later would answer a question nobody is still waiting on.
	const receive = (frame: unknown): void => {
		const json = typeof frame === "string" ? frame : JSON.stringify(frame)
		for (const listener of listeners) listener(json)
	}
	;(windowLike as Record<string, unknown>)[receiveName] = receive

	return {
		capabilities: { transfer: false },
		send(wire: string) {
			sink?.(wire)
		},
		subscribe(listener: (wire: string) => void) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		close() {
			listeners.clear()
			if ((windowLike as Record<string, unknown>)[receiveName] === receive) {
				delete (windowLike as Record<string, unknown>)[receiveName]
			}
		}
	}
}

/**
 * Create a transport between a page and the native application hosting it.
 *
 * ```ts
 * const channel = new RPCChannel(webViewTransport({ channelName: "xrossCrossFlow" }), { expose: api })
 * ```
 */
export function webViewTransport(options: WebViewTransportOptions): Transport<RPCMessage> {
	return createTransport({
		platform: webViewPlatform(options),
		codec: jsonCodec<RPCMessage>(),
		capabilities: { transfer: false },
		// A WebView's inbound hook is a public global: anything on the page, and
		// any host that mistakes the name, can call it. A malformed frame is
		// dropped rather than thrown into the receive loop, which would take the
		// channel down with it.
		onInvalidFrame: () => {}
	})
}

/**
 * Whether a native host is attached at all.
 *
 * A surface uses this to choose between talking to a host and running a local
 * fixture; without it the two are indistinguishable, because a page with no host
 * sends into a silent sink and simply never hears back.
 */
export function hasWebViewHost(options: WebViewTransportOptions): boolean {
	const windowLike = options.windowLike ?? (globalThis as unknown as WebViewHostWindow)
	if (windowLike.webkit?.messageHandlers?.[options.channelName]) return true
	const injected = windowLike[options.channelName] as { postMessage?: unknown } | undefined
	if (injected && typeof injected.postMessage === "function") return true
	return Boolean(windowLike.chrome?.webview)
}
