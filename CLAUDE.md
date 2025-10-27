# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

**kkrpc** is a TypeScript-first RPC library for seamless bi-directional communication between processes, workers, and contexts. It enables cross-runtime compatibility between Node.js, Deno, Bun, and browsers with full type safety.

### Architecture

The core architecture consists of:

- **RPCChannel** (`packages/kkrpc/src/channel.ts`): The main bidirectional RPC channel that handles message routing, pending requests, and callback management
- **IoInterface** (`packages/kkrpc/src/interface.ts`): Common interface for implementing communication adapters
- **Adapters** (`packages/kkrpc/src/adapters/`): Runtime-specific implementations:
  - `node.ts` - Node.js stdio communication
  - `deno.ts` - Deno stdio communication
  - `bun.ts` - Bun stdio communication
  - `worker.ts` - Web Worker communication
  - `iframe.ts` - iframe communication
  - `http.ts` - HTTP client/server communication
  - `websocket.ts` - WebSocket communication
  - `socketio.ts` - Socket.IO communication
  - `chrome-extension.ts` - Chrome extension port communication
  - `tauri.ts` - Tauri shell plugin communication

### Key Concepts

- **LocalAPI**: Functions exposed to the other side of the channel
- **RemoteAPI**: Functions exposed by the other side, callable locally
- **Serialization**: Supports both JSON and superjson (default) for enhanced type preservation
- **Bidirectional**: Both endpoints can expose and call APIs simultaneously
- **Property Access**: Remote getters/setters with dot notation support

## Development Commands

### Root Level Commands
```bash
# Build all packages
pnpm build

# Run all tests
pnpm test

# Run linting across all packages
pnpm lint

# Start development mode with watch
pnpm dev

# Format code
pnpm format

# Run tests in a specific package
pnpm --filter kkrpc test
```

### Package Development
```bash
# In packages/kkrpc/
bun run build          # Build the main package
bun run dev           # Watch mode development
bun run test          # Run tests
bun run docs          # Generate TypeDoc documentation
bun run prepare       # Prepare package for publishing
```

## Monorepo Structure

This is a **pnpm workspace** monorepo with **Turbo** for task orchestration:

- `packages/kkrpc/` - Main library package
- `packages/demo-api/` - Demo API implementation
- `examples/` - Example implementations:
  - `chrome-extension/` - Chrome extension communication
  - `http-demo/` - HTTP-based RPC
  - `iframe-worker-demo/` - iframe and Web Worker examples
  - `tauri-demo/` - Tauri desktop app integration

## Testing

Tests are located in `packages/kkrpc/__tests__/` and use various runtime scripts:
- `__tests__/scripts/node-api.ts` - Node.js test server
- `__tests__/scripts/deno-api.ts` - Deno test server
- `__tests__/scripts/bun-api.ts` - Bun test server
- `__tests__/scripts/worker.ts` - Web Worker test

Run tests with `bun run test` in the kkrpc package directory.

## Build System

- **tsdown** for TypeScript compilation with watch mode
- **TypeDoc** for API documentation generation
- **verify-package-export** for ensuring correct package exports
- **Turbo** for monorepo task orchestration
- **Bun** as the primary runtime for scripts and testing

## Package Exports

The main package provides multiple entry points:
- `.` - Main package (Node.js/Deno/Bun compatible)
- `./browser` - Browser-specific bundle
- `./http` - HTTP adapter only
- `./deno` - Deno-specific bundle
- `./chrome-extension` - Chrome extension adapter only
- `./socketio` - Socket.IO adapter only

## Environment Configuration

- **TypeScript**: Strict mode enabled, targeting ESNext
- **Package Manager**: pnpm (required for workspace)
- **Node Version**: >=18 required
- **Testing**: Uses Bun runtime for cross-platform compatibility

## Development Guidelines

### Svelte Development
- Always use Svelte 5 syntax (see `.cursor/rules/svelte5.mdc`)
- Import from Svelte 5 documentation when needed

### Code Organization
- Keep adapters runtime-specific and isolated
- Maintain TypeScript strict mode compliance
- Use proper error serialization across RPC boundaries
- Test cross-runtime compatibility before shipping changes

### Serialization Notes
- Default uses superjson for enhanced type support
- Backward compatibility with JSON format
- Error objects are fully preserved across RPC boundaries

This repository emphasizes cross-runtime compatibility, type safety, and seamless developer experience across JavaScript/TypeScript environments.