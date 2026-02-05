# kkrpc - DOCS SITE

**Generated:** 2026-02-05
**Location:** docs/

## OVERVIEW

Astro-based documentation site with Starlight theme. Deployed to GitHub Pages at https://kunkunsh.github.io/kkrpc/

## STRUCTURE

```
docs/
├── src/
│   ├── content/docs/     # Markdown documentation
│   │   ├── guides/       # User guides
│   │   ├── examples/     # Code examples
│   │   └── reference/    # API reference
│   └── styles/           # Custom CSS
├── public/               # Static assets
├── astro.config.mjs      # Astro configuration
└── package.json          # Dependencies
```

## KEY FILES

| File                        | Purpose                                  |
| --------------------------- | ---------------------------------------- |
| `astro.config.mjs`          | Site config, Starlight theme, navigation |
| `src/content/docs/`         | All documentation content                |
| `src/content/docs/llms.txt` | LLM-optimized documentation              |

## CONVENTIONS

- **Content**: Markdown with frontmatter
- **Organization**: Guides → Examples → Reference hierarchy
- **LLMs.txt**: Auto-generated or manually maintained for AI consumption

## COMMANDS

```bash
# Development
pnpm dev

# Build
pnpm build

# Preview
pnpm preview
```

## NOTES

- Auto-deployed on push to main
- Typedoc generates API reference separately
- LLMs.txt provides condensed context for AI tools
