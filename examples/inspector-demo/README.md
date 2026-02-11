# Inspector Demo

Demonstrates kkrpc traffic inspection with multiple backends.

## Features

- **Console Pretty-Print**: Colored terminal output with arrows and latency
- **File Logging**: NDJSON format for post-hoc analysis
- **Memory Backend**: Query and analyze traffic programmatically
- **Latency Tracking**: Automatic request/response timing

## Run

```bash
# Install dependencies
pnpm install

# Run client (spawns server automatically)
bun run client
```

## Output

```
[09:23:45] client-session → echo                     "Hello Inspector!"
[09:23:45] client-session ← echo                     12ms "Hello Inspector!"
[09:23:45] client-session → math.add                 [5,3]
[09:23:45] client-session ← math.add                 8ms 8
```

## Analysis

```bash
# Query the log file
jq 'select(.message.method=="echo")' inspector.log

# Find slow calls
jq 'select(.duration > 10)' inspector.log
```
