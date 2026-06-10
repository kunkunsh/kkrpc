# Inspector Demo

Demonstrates kkrpc traffic inspection with multiple backends.

## Features

- **Console Pretty-Print**: Colored terminal output with arrows and latency
- **File Logging**: NDJSON format for post-hoc analysis
- **Memory Backend**: Query and analyze traffic programmatically
- **Latency Tracking**: Automatic request/response timing

## Manual Testing

```bash
pnpm install
pnpm run client
```

`pnpm run client` starts the demo client. The client spawns the server automatically and records inspected traffic.

### What To Verify

- The terminal should print formatted request and response lines with arrows and latency.
- `inspector.log` should be created or updated with NDJSON traffic records.
- The demo should include calls such as `echo` and `math.add`.

### Optional Server-Only Run

```bash
pnpm run server
```

Use this only when you want to inspect the server process separately. In normal manual testing, `pnpm run client` is enough.

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
