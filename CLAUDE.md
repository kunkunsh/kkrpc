# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

kkrpc is a TypeScript-first RPC library for seamless bi-directional communication between processes, workers, and contexts. It provides cross-runtime compatibility with Node.js, Deno, Bun, and browsers.

## Development Commands

### Repository-wide Commands (run from root)

- `pnpm build` - Build all packages using Turbo
- `pnpm dev` - Start development mode with watch
- `pnpm test` - Run all tests across packages
- `pnpm lint` - Lint all packages
- `pnpm format` - Format code with Prettier
- `pnpm copy-readme` - Copy README to package directories

### Core Package Commands (packages/kkrpc)

- `pnpm build` - Build the kkrpc package (runs tsdown)
- `pnpm dev` - Watch mode for development
- `pnpm test` - Run tests using Bun scripts
- `pnpm docs` - Generate TypeDoc documentation

## Architecture

### Core Components

The library is built around these key architectural concepts:

1. **RPCChannel** (`packages/kkrpc/src/channel.ts`) - The main bidirectional RPC channel that handles method calls, property access, and callbacks
2. **IoInterface** (`packages/kkrpc/src/interface.ts`) - Interface for implementing communication adapters
3. **Adapters** (`packages/kkrpc/src/adapters/`) - Environment-specific IO implementations:
   - `node.ts` - Node.js stdio communication
   - `deno.ts` - Deno stdio communication
   - `bun.ts` - Bun stdio communication
   - `worker.ts` - Web Worker communication
   - `iframe.ts` - iframe communication
   - `websocket.ts` - WebSocket communication
   - `http.ts` - HTTP-based communication
   - `socketio.ts` - Socket.IO communication
   - `tauri.ts` - Tauri shell plugin integration
   - `chrome-extension.ts` - Chrome extension port communication

### Message System

- Messages are serialized using either JSON or superjson (default since v0.2.0)
- Supports bidirectional method calls, property getters/setters, constructors, and callbacks
- Error objects are fully preserved across RPC boundaries
- Callback functions can be passed as arguments to remote methods

### Entry Points

The package exports multiple entry points for different environments:

- Main entry (`.`) - Includes all server-side adapters (Node.js, Deno, Bun)
- Browser entry (`./browser`) - Browser-only adapters (Worker, iframe, Tauri)
- HTTP entry (`./http`) - HTTP client/server adapters
- Deno entry (`./deno`) - Deno-specific adapters
- Chrome Extension entry (`./chrome-extension`) - Chrome extension adapters
- Socket.IO entry (`./socketio`) - Socket.IO adapters

## Build System

- Uses **Turbo** for monorepo management and task orchestration
- **tsdown** for TypeScript compilation with multiple formats (ESM, CJS)
- **Bun** as the primary test runner and build tool
- **TypeDoc** for API documentation generation
- Outputs are generated in `dist/` with both ESM and CJS formats

## Package Structure

```
packages/kkrpc/
├── src/
│   ├── adapters/          # Environment-specific IO adapters
│   ├── channel.ts          # Core RPCChannel implementation
│   ├── interface.ts        # IoInterface definitions
│   ├── serialization.ts    # Message serialization logic
│   └── utils.ts           # Utility functions
├── mod.ts                 # Main entry point (server-side)
├── browser-mod.ts         # Browser entry point
├── http.ts               # HTTP entry point
├── deno-mod.ts           # Deno entry point
├── chrome-extension.ts   # Chrome extension entry point
├── socketio.ts           # Socket.IO entry point
└── tsdown.config.ts      # Build configuration
```

## Testing

- Tests are located in each package's test directories
- Use the root `pnpm test` to run all tests
- Individual package tests can be run with their specific test scripts
- The repository includes examples that serve as integration tests

## Examples

The `examples/` directory contains working demos for various environments:
- `http-demo/` - HTTP-based RPC with different server frameworks
- `tauri-demo/` - Desktop app with Tauri
- `chrome-extension/` - Chrome extension communication
- `iframe-worker-demo/` - Browser worker/iframe examples

## Development Notes

- Browser-specific code should import from `kkrpc/browser` instead of `kkrpc`
- The library uses superjson by default for enhanced serialization
- All adapters implement the same `IoInterface` for consistency
- The project uses pnpm workspaces for dependency management
- TypeScript 5.8.2 is the current version requirement