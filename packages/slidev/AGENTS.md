## Slidev Syntax Rules

### Slide Separators

**CRITICAL**: Slide separators use `---` on their own line. NEVER convert them to headers.

**CORRECT FORMAT**:

- Opening `---` followed immediately by frontmatter (no blank line)
- Frontmatter lines with no indentation
- Closing `---` followed immediately by slide content (no blank line before it)

```markdown
---
transition: slide-left
layout: two-cols-header
layoutClass: gap-4
---

# Slide Title
```

**WRONG** (never do this - header syntax):

```markdown
## transition: slide-left
```

**WRONG** (never do this - blank lines inside separator):

```markdown
---
transition: slide-left
---
```

**WRONG** (blank lines before frontmatter):

```markdown
---
transition: slide-left
layout: two-cols-header
layoutClass: gap-4
---
```

**WRONG** (blank lines before closing separator):

```markdown
---
transition: slide-left
layout: two-cols-header
layoutClass: gap-4
---
```

### Frontmatter Separators

Frontmatter at the top of the file uses `---` as well:

```markdown
---
theme: seriph
title: My Presentation
---

# First Slide
```

### Layout Directives

Common layout directives go in the slide separator block:

- `transition: slide-left|slide-up|fade-out`
- `layout: two-cols-header|center`
- `layoutClass: gap-4`
- `class: text-center`

### Columns

Use `::left::` and `::right::` for two-column layouts:

```markdown
::left::

Left content

::right::

Right content
```

## Complete Examples

### Example 1: Simple Slide with Transition

```markdown
---
transition: slide-left
---

# Key Features

- Feature 1
- Feature 2
- Feature 3
```

### Example 2: Two-Column Layout

```markdown
---
transition: slide-up
layout: two-cols-header
layoutClass: gap-4
---

# Comparison

::left::

### Traditional Approach

- Manual setup
- No type safety
- Lots of boilerplate

::right::

### With kkRPC

- Automatic setup
- Full type safety
- Minimal code
```

### Example 3: Centered Content

```markdown
---
transition: slide-up
class: text-center
---

# Get Started

## Installation

Install via npm or JSR
```

### Example 4: Multiple Properties

```markdown
---
layout: center
class: text-center
---

# Thank You!

Questions?
```

## Code Blocks

### TypeScript Code Block

```markdown
# Code Example

\`\`\`ts
const api = rpc.getAPI()
const result = await api.add(1, 2)
\`\`\`
```

### Magic Move (Animated Code)

```markdown
# Progressive Example

\`\`\`\`md magic-move {lines: true}
\`\`\`ts
// Step 1
export type API = {
add(a: number, b: number): Promise<number>
}
\`\`\`

\`\`\`ts
// Step 2
const api: API = {
add: (a, b) => Promise.resolve(a + b)
}
\`\`\`
\`\`\`\`
```

## Animations

### v-click for Sequential Reveals

```markdown
# Features

<v-clicks>

- First item (click to reveal)
- Second item (click to reveal)
- Third item (click to reveal)

</v-clicks>
```

### v-click for Single Element

```markdown
# Example

<v-click>
<div class="p-4 bg-green-900/30 rounded-lg">
  This appears on click
</div>
</v-click>
```

## Mermaid Diagrams

```markdown
# Architecture

\`\`\`mermaid {scale: 0.6}
graph TB
A[Component A] --> B[Component B]
B --> C[Component C]
\`\`\`
```

## Speaker Notes

Use HTML comments for speaker notes:

```markdown
# Slide Title

Content goes here

<!--
These are speaker notes.
They won't appear on the slide.
Multi-line notes are supported.
-->
```

## Common Patterns

### Grid Layout for Feature Cards

```markdown
# Features

<div class="grid grid-cols-4 gap-3 mt-2">

<div class="p-2 bg-blue-900/20 rounded-lg">
<h3 class="text-base font-bold text-blue-400">Feature 1</h3>
<p>Description here</p>
</div>

<div class="p-2 bg-green-900/20 rounded-lg">
<h3 class="text-base font-bold text-green-400">Feature 2</h3>
<p>Description here</p>
</div>

</div>
```

### Flex Layout for Icons

```markdown
# Environments

<div class="flex flex-wrap justify-center gap-4 mt-8">

<div class="flex flex-col items-center p-6 bg-slate-800 rounded-xl w-32">
<div class="text-4xl mb-2">Node.js</div>
<div class="text-xs text-gray-400">Runtime info</div>
</div>

</div>
```

## Anti-Patterns to Avoid

1. **Never use headers for frontmatter**: `## transition: slide-left` ❌
2. **Never add blank lines inside separators**: Between `---` and frontmatter ❌
3. **Never forget closing `---`**: Every opening needs a closing separator ❌
4. **Don't mix indentation**: Frontmatter should have no indentation ❌

## Quick Reference

| Pattern                    | Correct                            | Wrong                                  |
| -------------------------- | ---------------------------------- | -------------------------------------- |
| Separator format           | `---\ntransition: slide-left\n---` | `---\n\ntransition: slide-left\n\n---` |
| Header syntax              | `transition: slide-left`           | `## transition: slide-left`            |
| Blank line after separator | `---\n\n# Title`                   | `---\n# Title`                         |
| Two-column layout          | `::left::\n\nContent`              | `::left::\nContent`                    |

## References

- https://sli.dev/llms-full.txt
- https://sli.dev/llms.txt
