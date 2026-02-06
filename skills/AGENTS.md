# kkrpc - SKILLS DIRECTORY

**Generated:** 2026-02-06
**Location:** skills/

## OVERVIEW

Claude Code SKILL.md files for AI-assisted kkrpc development. These skills provide domain expertise to AI coding agents working with the kkrpc library.

## STRUCTURE

```
skills/
├── kkrpc/              # TypeScript kkrpc usage
│   └── SKILL.md        # How to use kkrpc in TypeScript projects
└── interop/            # Language interop
    └── SKILL.md        # Implement kkrpc in other languages
```

## KEY FILES

| File               | Purpose                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `kkrpc/SKILL.md`   | TypeScript usage: RPC channels, transports, callbacks, validation    |
| `interop/SKILL.md` | Cross-language: Protocol, message formats, reference implementations |

## CONVENTIONS

### SKILL.md Format

All skills follow the Agent Skills specification with YAML frontmatter:

```yaml
---
name: skill-name
description: Clear description of what this skill does
version: 1.0.0
license: MIT
---
```

### Content Organization

- **Overview**: Brief explanation of skill purpose
- **Core Concepts**: Key terminology and patterns
- **Step-by-Step Instructions**: Numbered guides
- **Examples**: Code samples with input/output
- **Common Pitfalls**: Mistakes to avoid
- **References**: Links to related documentation

## WHERE TO LOOK

| Task             | Location                               | Notes                             |
| ---------------- | -------------------------------------- | --------------------------------- |
| TypeScript usage | `kkrpc/SKILL.md`                       | RPC setup, transports, validation |
| Go interop       | `interop/SKILL.md` + `interop/go/`     | Reference implementation          |
| Python interop   | `interop/SKILL.md` + `interop/python/` | Reference implementation          |
| Rust interop     | `interop/SKILL.md` + `interop/rust/`   | Reference implementation          |
| Swift interop    | `interop/SKILL.md` + `interop/swift/`  | Reference implementation          |

## COMMANDS

```bash
# Copy skills to global Claude Code config
cp -r skills/kkrpc ~/.claude/skills/
cp -r skills/interop ~/.claude/skills/

# Or symlink for development
ln -s $(pwd)/skills/kkrpc ~/.claude/skills/kkrpc
ln -s $(pwd)/skills/interop ~/.claude/skills/interop
```

## NOTES

### Skill Activation

Skills are automatically activated when Claude Code detects relevant context:

- **kkrpc skill**: Triggered by mentions of "kkrpc", "RPCChannel", transport names
- **interop skill**: Triggered by mentions of cross-language RPC, Go/Python/Rust/Swift interop

### Skill Scope

- **Global scope**: Copy to `~/.claude/skills/` for all projects
- **Project scope**: Copy to `.claude/skills/` for project-specific usage

### Maintenance

When updating kkrpc features:

1. Update relevant SKILL.md files
2. Keep examples working with current API
3. Document breaking changes in migration sections

## ANTI-PATTERNS

- ❌ **Do not** commit skills to version control as binary files
- ❌ **Do not** duplicate content between skills - reference instead
- ❌ **Do not** use skills for dynamic/runtime configuration
