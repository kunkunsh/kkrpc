# Work Plan: Create kkRPC Slidev Presentation

## TL;DR

> **Quick Summary**: Create a comprehensive Slidev presentation showcasing kkRPC library for YouTube video. Focus on pain points vs solutions with side-by-side code comparisons for Electron, Tauri, Web Workers, and iframes.
>
> **Deliverables**:
>
> - Complete slides.md with 15+ slides
> - Before/After code comparisons for 4 platforms
> - Professional styling and animations
> - Mermaid diagrams and visual elements
>
> **Estimated Effort**: Medium (1-2 hours)
> **Parallel Execution**: NO - sequential content creation
> **Critical Path**: Structure → Content → Styling → Review

---

## Context

### Original Request

User wants to create a YouTube video presenting kkRPC - a TypeScript-first RPC library for cross-runtime communication. The presentation should:

1. Show pain points of traditional IPC approaches
2. Demonstrate kkRPC solutions with side-by-side comparisons
3. Focus on: Electron (Renderer↔Main), Tauri (Frontend↔Sidecar), Web Workers, iframes
4. Keep content concise and engaging
5. Reference examples folder, particularly Tauri demo

### Interview Summary

**Key Discussions**:

- User wants to "sell the product" through pain point → solution narrative
- Platform comparisons should be left/right (before/after) format
- Target YouTube audience (developers)
- Concise slides, not overloaded with text

### Research Findings

- kkRPC README has comprehensive examples
- examples/ folder contains working demos:
  - `examples/electron-demo/` - Full Electron IPC demo
  - `examples/tauri-demo/` - Tauri sidecar demo
  - `examples/iframe-worker-demo/` - iframe and Web Worker demos
- Docs in `docs/src/content/docs/examples/` have code snippets

---

## Work Objectives

### Core Objective

Create a professional Slidev presentation that effectively demonstrates kkRPC's value proposition through pain point/solution comparisons across 4 major platforms.

### Concrete Deliverables

- [ ] Complete `packages/slidev/slides.md` file
- [ ] 15-18 slides with clear narrative flow
- [ ] Side-by-side code comparisons (4 platforms)
- [ ] Mermaid architecture diagram
- [ ] Feature showcase with visual elements
- [ ] Call-to-action slide with links

### Definition of Done

- [ ] All slides render correctly with `pnpm dev`
- [ ] Code examples are accurate and concise
- [ ] Before/After comparisons are clear
- [ ] No LSP errors in code blocks
- [ ] Professional appearance with consistent styling

### Must Have

- Electron comparison (traditional IPC vs kkRPC)
- Tauri comparison (commands vs sidecar RPC)
- Web Worker comparison (postMessage vs direct calls)
- iframe comparison (manual postMessage vs type-safe RPC)
- Architecture explanation
- Feature showcase
- Comparison with alternatives (tRPC, Comlink)

### Must NOT Have (Guardrails)

- ❌ Overloaded text walls
- ❌ More than 15 lines of code per side in comparisons
- ❌ Incorrect code examples
- ❌ Missing type annotations
- ❌ External dependencies beyond Slidev basics

---

## Execution Strategy

### Sequential Task Flow

```
Task 1 (Structure) → Task 2 (Content) → Task 3 (Styling) → Task 4 (Review)
```

| Task | Description                                 | Estimated Time |
| ---- | ------------------------------------------- | -------------- |
| 1    | Create slides.md structure with frontmatter | 15 min         |
| 2    | Write all slide content with code examples  | 45 min         |
| 3    | Add custom styles, animations, diagrams     | 20 min         |
| 4    | Test rendering and fix issues               | 10 min         |

---

## TODOs

- [ ] 1. Create slides.md structure

  **What to do**:

  - Replace default Slidev template with kkRPC presentation
  - Set up theme: seriph with dark mode
  - Configure frontmatter (title, info, duration)
  - Create slide skeleton (18 slides)

  **Must NOT do**:

  - Keep any default Slidev example content
  - Use light theme (should be dark/professional)

  **Recommended Agent Profile**:

  - **Category**: `visual-engineering`
  - **Reason**: Frontend/styling focus for presentation
  - **Skills**: `frontend-ui-ux`

  **Parallelization**: NO - first task, sequential

  **References**:

  - `/packages/slidev/slides.md` - Target file to create
  - `/packages/slidev/package.json` - Slidev dependencies
  - `/packages/kkrpc/README.md` - Source content
  - `https://sli.dev/guide/syntax.html` - Slidev syntax reference

  **Acceptance Criteria**:

  - [ ] File created at `/packages/slidev/slides.md`
  - [ ] All 18 slide sections present (marked with `---`)
  - [ ] Proper frontmatter configured
  - [ ] Comment notes included for each slide

  **Commit**: NO (single commit at end)

- [ ] 2. Write slide content with code examples

  **What to do**:

  - **Slide 1**: Title slide with kkRPC branding
  - **Slide 2**: Problem statement (pain points)
  - **Slides 3-6**: Before/After comparisons:
    - Slide 3: Electron (ipcRenderer vs kkRPC)
    - Slide 4: Tauri (commands vs sidecar)
    - Slide 5: Web Workers (postMessage vs direct calls)
    - Slide 6: iframes (manual vs type-safe)
  - **Slide 7**: Architecture diagram (Mermaid)
  - **Slide 8**: Key features grid
  - **Slide 9**: Supported environments
  - **Slides 10-11**: Code examples (stdio, nested APIs)
  - **Slide 12**: Comparison with alternatives
  - **Slides 13-14**: Get started / CTA
  - **Slide 15**: Thank you

  **Code Examples to Include**:

  **Electron Before**:

  ```ts
  // Preload
  contextBridge.exposeInMainWorld("api", {
  	getVersion: () => ipcRenderer.invoke("get-version")
  })

  // Main
  ipcMain.handle("get-version", () => app.getVersion())

  // Renderer
  const version = await window.api.getVersion() // No types!
  ```

  **Electron After**:

  ```ts
  type MainAPI = { getVersion(): Promise<string> }
  const rpc = new RPCChannel(io, { expose: api })
  const api = rpc.getAPI<MainAPI>()
  const version = await api.getVersion() // Typed!
  ```

  **Tauri Before**:

  ```ts
  // Rust
  #[tauri::command]
  fn greet(name: &str) -> String { ... }

  // Frontend
  const response = await invoke('greet', { name: 'World' })
  ```

  **Tauri After**:

  ```ts
  const cmd = Command.create("deno", ["api.ts"])
  const process = await cmd.spawn()
  const api = rpc.getAPI<API>()
  const result = await api.greet("World")
  ```

  **Web Worker Before**:

  ```ts
  worker.postMessage({ type: "add", data: [1, 2] })
  worker.onmessage = (e) => console.log(e.data.result)
  ```

  **Web Worker After**:

  ```ts
  const api = rpc.getAPI()
  const result = await api.add(1, 2)
  ```

  **Must NOT do**:

  - Include more than 15 lines per code block
  - Use incorrect TypeScript syntax
  - Forget type annotations

  **Recommended Agent Profile**:

  - **Category**: `writing`
  - **Reason**: Content creation, technical writing
  - **Skills**: `frontend-ui-ux`

  **Parallelization**: NO - builds on Task 1

  **References**:

  - `/examples/electron-demo/electron/main.ts` - Electron example
  - `/examples/tauri-demo/src/routes/+page.svelte` - Tauri example
  - `/examples/iframe-worker-demo/src/routes/web-worker/+page.svelte` - Worker example
  - `/docs/src/content/docs/examples/iframe.md` - iframe docs

  **Acceptance Criteria**:

  - [ ] All 15 slides have complete content
  - [ ] Code examples are syntactically correct
  - [ ] Before/After comparisons are balanced
  - [ ] Mermaid diagram renders correctly
  - [ ] No placeholder text remains

  **Commit**: NO (single commit at end)

- [ ] 3. Add custom styles and animations

  **What to do**:

  - Add custom CSS in slide scope style blocks where needed
  - Use `v-click` for progressive reveals
  - Configure `magic-move` for code animations
  - Use `two-cols` layout for comparisons
  - Add color coding (red for pain, green for solution)

  **Styling Requirements**:

  - Dark theme consistent with dev tools aesthetic
  - Code blocks with proper syntax highlighting
  - Visual hierarchy with headings and spacing
  - Feature badges with colored backgrounds
  - Platform icons/logos where appropriate

  **Must NOT do**:

  - Overuse animations (keep it professional)
  - Use clashing colors
  - Break mobile compatibility

  **Recommended Agent Profile**:

  - **Category**: `visual-engineering`
  - **Reason**: Styling and visual polish
  - **Skills**: `frontend-ui-ux`

  **Parallelization**: NO - builds on Task 2

  **References**:

  - `https://sli.dev/guide/animations.html` - Slidev animations
  - `https://sli.dev/builtin/layouts.html` - Built-in layouts
  - `https://sli.dev/features/mermaid.html` - Mermaid diagrams

  **Acceptance Criteria**:

  - [ ] All animations work smoothly
  - [ ] Two-column layouts render correctly
  - [ ] Color scheme is consistent
  - [ ] Mermaid diagram displays properly
  - [ ] No visual glitches

  **Commit**: NO (single commit at end)

- [ ] 4. Test and verify presentation

  **What to do**:

  - Run `pnpm install` in `/packages/slidev/`
  - Run `pnpm dev` to start Slidev
  - Navigate through all slides
  - Check code syntax highlighting
  - Verify Mermaid diagrams render
  - Test animations and transitions

  **Verification Checklist**:

  - [ ] Title slide displays correctly
  - [ ] All code blocks have syntax highlighting
  - [ ] Before/After comparisons are side-by-side
  - [ ] Mermaid architecture diagram renders
  - [ ] Feature grid layout is balanced
  - [ ] All transitions work smoothly
  - [ ] No console errors
  - [ ] Mobile view is acceptable

  **Recommended Agent Profile**:

  - **Category**: `quick`
  - **Reason**: Testing and verification
  - **Skills**: `frontend-ui-ux`

  **Parallelization**: NO - final verification

  **Acceptance Criteria**:

  - [ ] Presentation runs without errors
  - [ ] All slides visible and readable
  - [ ] No broken code examples
  - [ ] Export to PDF works (if needed)

  **Commit**: YES

  - Message: `feat(slidev): Add kkRPC presentation for YouTube video`
  - Files: `packages/slidev/slides.md`

---

## Slide Structure Reference

| #   | Slide Title   | Layout      | Key Content             |
| --- | ------------- | ----------- | ----------------------- |
| 1   | Title         | text-center | kkRPC branding, tagline |
| 2   | The Problem   | default     | Pain points list        |
| 3   | Electron      | two-cols    | ipcRenderer vs kkRPC    |
| 4   | Tauri         | two-cols    | Commands vs sidecar     |
| 5   | Web Workers   | two-cols    | postMessage vs direct   |
| 6   | iframes       | two-cols    | Manual vs type-safe     |
| 7   | Architecture  | default     | Mermaid diagram         |
| 8   | Key Features  | default     | Feature grid (8 items)  |
| 9   | Environments  | default     | Platform icons          |
| 10  | Quick Example | default     | Node ↔ Deno code       |
| 11  | Advanced      | default     | Nested APIs, callbacks  |
| 12  | Comparison    | two-cols    | vs tRPC, Comlink        |
| 13  | Get Started   | text-center | Install commands        |
| 14  | Links         | text-center | GitHub, docs, npm       |
| 15  | Thank You     | text-center | CTA, star request       |

---

## Resources

### Content Sources

- `/packages/kkrpc/README.md` - Main documentation
- `/examples/electron-demo/` - Electron implementation
- `/examples/tauri-demo/` - Tauri implementation
- `/examples/iframe-worker-demo/` - Worker/iframe examples
- `/docs/src/content/docs/examples/` - All example docs

### Slidev Documentation

- `https://sli.dev/` - Official docs
- `https://sli.dev/guide/syntax.html` - Markdown syntax
- `https://sli.dev/features/mermaid.html` - Diagrams
- `https://sli.dev/builtin/layouts.html` - Layouts

---

## Success Criteria

### Verification Commands

```bash
cd /Users/hk/Dev/kkrpc/packages/slidev
pnpm install
pnpm dev
# Then visit http://localhost:3030 and verify all slides
```

### Final Checklist

- [ ] All 15 slides created and populated
- [ ] Code examples are accurate and type-safe
- [ ] Before/After comparisons are compelling
- [ ] Presentation renders without errors
- [ ] Professional appearance suitable for YouTube
- [ ] All links and references are correct

---

## Notes

### Design Decisions

- **Theme**: `seriph` - Professional, developer-friendly
- **Color Scheme**: Dark mode with syntax highlighting
- **Layout**: Two-cols for comparisons, centered for CTAs
- **Animations**: Progressive reveals with v-click, magic-move for code

### Content Strategy

- Lead with pain points to hook the audience
- Show concrete before/after examples
- Demonstrate breadth (15+ transports)
- End with clear CTA (star on GitHub)

### Potential Challenges

- Code examples must be concise (15 lines max per side)
- Mermaid diagram syntax must be correct
- TypeScript types must be accurate
- Animations must not be distracting
