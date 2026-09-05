#if canImport(WebKit)
import XCTest
import WebKit
@testable import kkrpc

final class WebViewTransportTests: XCTestCase {
    @MainActor
    private func makeWebView() -> WKWebView {
        WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    }

    /// A frame the page posts as text arrives as the same JSON line.
    func testDeliversAStringBody() async throws {
        let webView = await makeWebView()
        let transport = WebViewTransport(webView: webView, channelName: "surface")
        await transport.deliver("{\"t\":\"r\",\"id\":\"1\"}")
        let line = try await transport.read()
        XCTAssertEqual(line, "{\"t\":\"r\",\"id\":\"1\"}")
    }

    /// WebKit hands a posted object back already deserialised, so the transport
    /// has to re-encode it rather than assume text.
    func testDeliversADictionaryBody() async throws {
        let webView = await makeWebView()
        let transport = WebViewTransport(webView: webView, channelName: "surface")
        await transport.deliver(["t": "r", "id": "7"] as [String: Any])
        let line = try await transport.read()
        let decoded = try XCTUnwrap(line.flatMap { try? decodeMessage($0) })
        XCTAssertEqual(decoded["t"] as? String, "r")
        XCTAssertEqual(decoded["id"] as? String, "7")
    }

    /// The handler name is public: a page may post anything to it.
    func testDropsABodyItCannotRead() async throws {
        let webView = await makeWebView()
        let transport = WebViewTransport(webView: webView, channelName: "surface")
        await transport.deliver(42)
        await transport.deliver("{\"t\":\"r\",\"id\":\"after\"}")
        let line = try await transport.read()
        XCTAssertEqual(line, "{\"t\":\"r\",\"id\":\"after\"}", "the unreadable body was dropped, not queued")
    }

    /// A read that arrives before any frame does must wait rather than return
    /// `nil`, which the RPC loops treat as a closed transport.
    func testAReadWaitsForALaterFrame() async throws {
        let webView = await makeWebView()
        let transport = WebViewTransport(webView: webView, channelName: "surface")
        let pending = Task { try await transport.read() }
        try await Task.sleep(nanoseconds: 20_000_000)
        await transport.deliver("{\"t\":\"q\",\"id\":\"2\"}")
        let line = try await pending.value
        XCTAssertEqual(line, "{\"t\":\"q\",\"id\":\"2\"}")
    }

    /// Closing releases a waiting reader with `nil`, which is how the loops stop.
    func testCloseEndsAWaitingRead() async throws {
        let webView = await makeWebView()
        let transport = WebViewTransport(webView: webView, channelName: "surface")
        let pending = Task { try await transport.read() }
        try await Task.sleep(nanoseconds: 20_000_000)
        await transport.close()
        let line = try await pending.value
        XCTAssertNil(line)
    }

    /// **The startup case, and the reason this transport buffers at all.** A host
    /// that pushes a first snapshot before the page has installed its hook would
    /// otherwise lose it, and the page would sit empty waiting for something
    /// already sent.
    func testWritesBeforeThePageIsReadyAreHeldAndNotLost() async throws {
        let webView = await makeWebView()
        let transport = WebViewTransport(webView: webView, channelName: "surface")
        try await transport.write("{\"t\":\"r\",\"id\":\"early\"}")
        let held = await transport.heldWriteCountForTesting
        XCTAssertEqual(held, 1)

        await transport.pageDidLoad()
        let afterFlush = await transport.heldWriteCountForTesting
        XCTAssertEqual(afterFlush, 0, "the held frame was flushed on load")
    }

    func testWriteAfterCloseIsRefused() async throws {
        let webView = await makeWebView()
        let transport = WebViewTransport(webView: webView, channelName: "surface")
        await transport.close()
        do {
            try await transport.write("{}")
            XCTFail("a closed transport accepted a write")
        } catch KkrpcError.transportClosed {
            // expected
        }
    }

    /// A device name with a quote in it must not become a syntax error in the
    /// script the host evaluates.
    func testEncodesAFrameAsAJavaScriptStringLiteral() throws {
        let literal = try XCTUnwrap(
            WebViewTransport.javaScriptStringLiteral("{\"name\":\"Bob's \\\"Mac\\\"\"}")
        )
        XCTAssertTrue(literal.hasPrefix("\""))
        XCTAssertTrue(literal.hasSuffix("\""))
        XCTAssertFalse(literal.dropFirst().dropLast().contains("\"\""))
    }
}
#endif
