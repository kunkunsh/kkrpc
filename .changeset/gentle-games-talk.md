---
"kkrpc": minor
---

Add a dedicated `kkrpc/godot` entry for bidirectional JSON-line RPC. `godotStdioTransport()` serves
a dedicated Godot subprocess, while `godotChildProcessTransport()` lets Godot start and communicate
with Node.js or Bun children without blocking the game loop.
