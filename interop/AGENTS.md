# kkrpc - LANGUAGE INTEROP

**Generated:** 2026-02-05
**Location:** interop/

## OVERVIEW

Language interoperability implementations for kkrpc. Enables RPC communication between TypeScript/JavaScript hosts and Go, Python, Rust, and Swift clients/servers.

## STRUCTURE

```
interop/
├── go/              # Go implementation
│   └── kkrpc/       # Go package
├── python/          # Python implementation
│   └── kkrpc/       # Python package + adapters
├── rust/            # Rust implementation
│   ├── src/         # Rust source
│   └── tests/       # Rust tests
├── swift/           # Swift implementation
│   ├── Sources/     # Swift source
│   └── Tests/       # Swift tests
└── node/            # Node.js interop utilities
```

## INTEROP PATTERNS

### Protocol Compatibility

All implementations use the stable compact JSON `RPCMessage` protocol:

- Request: `{ t: "q", id, op: "call" | "get" | "set" | "new", p, a?, v? }`
- Response: `{ t: "r", id, v?, e? }`
- Callback: `{ t: "cb", id, a }`
- JSON-only compact records; non-JS interop does not use JS codec configuration options.

### Adapter Parity

| Transport | Go  | Python | Rust | Swift |
| --------- | --- | ------ | ---- | ----- |
| stdio     | ✓   | ✓      | ✓    | ✓     |
| WebSocket | ✓   | ✓      | ✓    | ✗     |
| HTTP      | ✓   | ✓      | ✓    | ✗     |

## CONVENTIONS

- **Naming**: Follow language conventions (snake_case Python, CamelCase Go, etc.)
- **Protocol**: Maintain message format compatibility with TypeScript reference
- **Tests**: Each language has its own test suite

## NOTES

- Go: Uses standard library, no external deps
- Python: Uses asyncio for async support
- Rust: Uses tokio runtime
- Swift: Uses Foundation and Combine

## HIERARCHY

```
interop/
├── go/
├── python/
├── rust/
├── swift/
└── node/
```
