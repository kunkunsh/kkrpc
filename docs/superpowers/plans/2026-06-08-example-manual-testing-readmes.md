# Example Manual Testing READMEs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clear manual testing instructions to every example README.

**Architecture:** This is a documentation-only update. Each example README keeps its existing overview and gains a concise `Manual Testing` section with commands, expected success signals, and targeted troubleshooting where useful.

**Tech Stack:** Markdown, pnpm workspace scripts, Bun, Deno, Vite, Electron, Tauri, Chrome Extension loading.

---

### Task 1: Update Workspace Example READMEs

**Files:**

- Modify: `examples/chrome-extension/README.md`
- Modify: `examples/electron-demo/README.md`
- Modify: `examples/http-demo/README.md`
- Modify: `examples/iframe-worker-demo/README.md`
- Modify: `examples/inspector-demo/README.md`
- Modify: `examples/streaming-middleware-demo/README.md`
- Modify: `examples/tauri-demo/README.md`
- Modify: `examples/transferable-browser/README.md`

- [ ] **Step 1: Add manual testing sections**

For each README, add or revise a `Manual Testing` section with exact commands and expected visible behavior. Use the example's existing package scripts from its `package.json`.

- [ ] **Step 2: Preserve existing content**

Keep existing overview, architecture, and feature documentation. Do not remove useful current instructions unless replacing them with more specific manual testing steps.

### Task 2: Update Deno-Only Example READMEs

**Files:**

- Modify: `examples/deno-backend/README.md`
- Modify: `examples/deno-webworker-demo/README.md`

- [ ] **Step 1: Add Deno command instructions**

Document the exact `deno` commands and permissions needed to run each example from its directory.

- [ ] **Step 2: Add success signals**

Describe the terminal output that indicates the example is working.

### Task 3: Verify Docs Update

**Files:**

- Read: all updated README files

- [ ] **Step 1: Inspect README headings**

Run: `grep -n "Manual Testing\|What To Verify\|Troubleshooting" examples/*/README.md`

Expected: each example README has a clear manual testing section or equivalent headings.

- [ ] **Step 2: Run examples typecheck**

Run: `pnpm --filter "./examples/*" check-types`

Expected: command exits 0.

- [ ] **Step 3: Review git status**

Run: `git status --short`

Expected: only README/doc changes plus existing uncommitted migration slice files are present.
