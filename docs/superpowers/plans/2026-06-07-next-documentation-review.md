# kkrpc/next Documentation Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the new `kkrpc/next` implementation reviewable by adding source docstrings, examples, and a high-level architecture document.

**Architecture:** Documentation is split between code-local JSDoc and a single high-level Markdown review document. Source files explain local responsibilities and usage examples; `NEXT_ARCHITECTURE.md` explains module boundaries, tree-shaking, bundle-size strategy, classic compatibility, and remaining migration work.

**Tech Stack:** TypeScript JSDoc, Markdown, Mermaid diagrams, existing bundle benchmark script.

---

### Task 1: Add High-Level Architecture Document

**Files:**

- Create: `packages/kkrpc/NEXT_ARCHITECTURE.md`

- [ ] **Step 1: Create architecture document**

Add a Markdown document covering:

- What `kkrpc/next` is and why it exists.
- Core modules and optional feature modules.
- Mermaid module graph and call flow diagrams.
- Tree-shaking rules and package export boundaries.
- Bundle-size measurement command and how to compare with `comctx`.
- Classic compatibility scope and limitations.
- Remaining migration work for examples, tests, and MQ transports.

- [ ] **Step 2: Review for ambiguity**

Run: `grep -n "TBD\|TODO\|FIXME" packages/kkrpc/NEXT_ARCHITECTURE.md`
Expected: no unresolved placeholders.

### Task 2: Add JSDoc to Internal vNext Source Files

**Files:**

- Modify: `packages/kkrpc/src/next/channel.ts`
- Modify: `packages/kkrpc/src/next/protocol.ts`
- Modify: `packages/kkrpc/src/next/transport.ts`
- Modify: `packages/kkrpc/src/next/codecs.ts`
- Modify: `packages/kkrpc/src/next/plugins.ts`
- Modify: `packages/kkrpc/src/next/validation.ts`
- Modify: `packages/kkrpc/src/next/middleware.ts`
- Modify: `packages/kkrpc/src/next/superjson.ts`
- Modify: `packages/kkrpc/src/next/classic-compat.ts`
- Modify: `packages/kkrpc/src/next/worker.ts`
- Modify: `packages/kkrpc/src/next/stdio.ts`
- Modify: `packages/kkrpc/src/next/index.ts`

- [ ] **Step 1: Add file-level docstrings**

Each source file should start with a JSDoc block describing:

- File responsibility.
- Design role in the vNext architecture.
- What the file intentionally does not import to preserve tree-shaking.

- [ ] **Step 2: Add exported API examples**

Add `@example` blocks to exported functions/classes where useful:

- `RPCChannel`, `wrap`, `expose`, `dispose`.
- `createTransport`, `objectCodec`, `jsonCodec`, `jsonLineCodec`.
- `validationPlugin`, `middlewarePlugin`, `superJsonCodec`.
- `classicPlugins`, `wrapCompat`, `exposeCompat`.
- `workerTransport`, `workerSelfTransport`, `stdioPlatform`, `stdioJsonTransport`, `nodeStdioTransport`.

### Task 3: Add JSDoc to Public vNext Entry Files

**Files:**

- Modify: `packages/kkrpc/next.ts`
- Modify: `packages/kkrpc/next-transport.ts`
- Modify: `packages/kkrpc/next-codecs.ts`
- Modify: `packages/kkrpc/next-plugins.ts`
- Modify: `packages/kkrpc/next-validation.ts`
- Modify: `packages/kkrpc/next-middleware.ts`
- Modify: `packages/kkrpc/next-superjson.ts`
- Modify: `packages/kkrpc/next-classic-compat.ts`
- Modify: `packages/kkrpc/next-worker.ts`
- Modify: `packages/kkrpc/next-stdio.ts`

- [ ] **Step 1: Explain public import paths**

Each entry file should document its public package path, intended users, and what dependency weight it adds.

### Task 4: Verify Documentation Changes

**Files:**

- Read-only verification across modified docs and TypeScript files.

- [ ] **Step 1: Run TypeScript checks**

Run: `pnpm --filter kkrpc check-types`
Expected: `tsc --noEmit` succeeds.

- [ ] **Step 2: Run focused vNext tests**

Run: `bun test __tests__/next-validation.test.ts __tests__/next-middleware.test.ts __tests__/next-plugins.test.ts __tests__/next-superjson.test.ts __tests__/next-classic-compat.test.ts __tests__/next-core.test.ts __tests__/next-transport-codecs.test.ts __tests__/next-worker.test.ts __tests__/next-stdio.test.ts`
Expected: all tests pass.

- [ ] **Step 3: Run bundle comparison if docs cite exact sizes**

Run: `pnpm --filter kkrpc compare:browser-bundle-size`
Expected: command succeeds and `NEXT_ARCHITECTURE.md` size numbers match the latest output.
