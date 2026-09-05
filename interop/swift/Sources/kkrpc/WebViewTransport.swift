#if canImport(WebKit)
import Foundation
import WebKit

/// A ``Transport`` between a native application and a page it is hosting in a
/// `WKWebView`.
///
/// The other transports here assume a stream: ``StdioTransport`` reads a file
/// handle, ``WebSocketTransport`` reads frames off a socket. A `WKWebView` is
/// neither. What it offers is two one-way halves that have to be joined:
///
/// - **Page to host**: `WKUserContentController.add(_:name:)` registers a named
///   handler and the page calls `window.webkit.messageHandlers.<name>.postMessage`.
///   The body arrives as an already-deserialised value, so a frame sent as an
///   object arrives as `[String: Any]` and one sent as text arrives as `String`;
///   both are accepted, and both are turned back into the JSON line the rest of
///   kkrpc expects.
/// - **Host to page**: there is no inverse of `postMessage`, so the host has to
///   *evaluate* a call to a function the page installed. The name matches the
///   TypeScript `webview` transport's default, `__kkrpc_<channelName>`, so
///   neither side has to be told what the other chose.
///
/// # Two things this deliberately does
///
/// **It never fails a write for a page that is not ready.** A `WKWebView` that
/// has not finished loading has no such function, and `evaluateJavaScript`
/// reports that as an error. Frames written before the page announces itself are
/// therefore held and flushed in order once it does — without that, every RPC
/// made during startup is lost, which is exactly when a host wants to push a
/// first snapshot.
///
/// **It encodes the frame as a JSON string literal, not as an object literal.**
/// Interpolating a JSON object into a script is how a quote inside a device name
/// becomes a syntax error; JSON's string grammar is a subset of JavaScript's, so
/// a JSON-encoded string is always a valid literal.
public actor WebViewTransport: Transport {
    private let channelName: String
    private let receiveName: String
    private weak var webView: WKWebView?

    private var inbox: [String] = []
    private var waiting: CheckedContinuation<String?, Never>?
    private var pendingWrites: [String] = []
    private var pageIsReady = false
    private var isClosed = false

    /// - Parameters:
    ///   - webView: the view hosting the page. Held weakly: the view owns its
    ///     configuration, which owns the message handler, which owns this.
    ///   - channelName: the name the page posts to and the host registered.
    ///   - receiveName: the page-side function the host calls. Defaults to the
    ///     TypeScript transport's own default.
    public init(webView: WKWebView, channelName: String, receiveName: String? = nil) {
        self.webView = webView
        self.channelName = channelName
        self.receiveName = receiveName ?? "__kkrpc_\(channelName)"
    }

    /// Called by the host when the page has installed its inbound hook.
    ///
    /// Everything written before this point is flushed here, in order.
    public func pageDidLoad() async {
        pageIsReady = true
        let held = pendingWrites
        pendingWrites = []
        for frame in held {
            await evaluate(frame)
        }
    }

    /// Called by the host's `WKScriptMessageHandler` for every frame the page posts.
    ///
    /// `body` is whatever WebKit deserialised: a `String` for a page that sent
    /// text, or a dictionary for one that sent an object. Anything else is
    /// dropped — the handler name is a public surface and a page may post to it
    /// by mistake.
    public func deliver(_ body: Any) {
        guard !isClosed else { return }
        let json: String?
        switch body {
        case let text as String:
            json = text
        case let object as [String: Any]:
            json = (try? JSONSerialization.data(withJSONObject: object)).flatMap {
                String(data: $0, encoding: .utf8)
            }
        default:
            json = nil
        }
        guard let json else { return }

        if let waiting {
            self.waiting = nil
            waiting.resume(returning: json)
        } else {
            inbox.append(json)
        }
    }

    public func read() async throws -> String? {
        if isClosed { return nil }
        if !inbox.isEmpty {
            return inbox.removeFirst()
        }
        return await withCheckedContinuation { continuation in
            if isClosed {
                continuation.resume(returning: nil)
            } else {
                waiting = continuation
            }
        }
    }

    public func write(_ message: String) async throws {
        guard !isClosed else { throw KkrpcError.transportClosed }
        let frame = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !frame.isEmpty else { return }
        guard pageIsReady else {
            pendingWrites.append(frame)
            return
        }
        await evaluate(frame)
    }

    public func close() async {
        isClosed = true
        pendingWrites = []
        inbox = []
        if let waiting {
            self.waiting = nil
            waiting.resume(returning: nil)
        }
    }

    /// How many frames are waiting for the page to install its hook. Test-only,
    /// and named so: the buffering is the behaviour worth asserting and there is
    /// no other way to observe it without a live page.
    var heldWriteCountForTesting: Int { pendingWrites.count }

    private func evaluate(_ frame: String) async {
        guard let literal = Self.javaScriptStringLiteral(frame) else { return }
        let script = "globalThis.\(receiveName) && globalThis.\(receiveName)(\(literal))"
        let webView = self.webView
        await MainActor.run {
            webView?.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    /// A JavaScript string literal for arbitrary text.
    ///
    /// JSON's string grammar is a subset of JavaScript's, so a JSON-encoded
    /// string is a valid JS literal — the same trick the rest of this project
    /// uses for pasted terminal text, and the reason a device name containing a
    /// quote does not become a syntax error.
    static func javaScriptStringLiteral(_ value: String) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: [value]),
              let array = String(data: data, encoding: .utf8),
              array.count > 2
        else { return nil }
        return String(array.dropFirst().dropLast())
    }
}

/// Bridges `WKScriptMessageHandler`'s synchronous, main-actor callback into the
/// transport's actor.
///
/// A separate object rather than a conformance on ``WebViewTransport`` because
/// `WKUserContentController` **retains** its handler, and a transport retained by
/// the configuration it is attached to can never be released. This holds the
/// transport weakly for the same reason.
public final class WebViewTransportMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var transport: WebViewTransport?

    public init(transport: WebViewTransport) {
        self.transport = transport
    }

    public func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        let body = message.body
        guard let transport else { return }
        Task { await transport.deliver(body) }
    }
}
#endif
