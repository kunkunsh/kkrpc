---
"kkrpc": minor
---

Add bidirectional JSON-line RPC for GodotJS: `godotStdioTransport()` serves a dedicated Godot
subprocess, while `godotChildProcessTransport()` lets Godot start and communicate with Node.js or
Bun children without blocking the game loop.
