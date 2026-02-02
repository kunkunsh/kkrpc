## Implement Event-Driven Relay - Learnings

### Completed: 2026-02-02

## Summary

Successfully implemented event-driven relay system for kkrpc:

1. **Extended IoInterface** with optional `onMessage` callback
2. **Updated NodeIo adapter** to support event-driven mode
3. **Updated ElectronIpcMainIO adapter** to support event-driven mode
4. **Rewrote createRelay()** using event callbacks instead of while loops
5. **Refactored electron-demo** to use cleaner stdio delegation

## Key Improvements

### Before (While Loop)

```typescript
export function createRelay(a: IoInterface, b: IoInterface) {
	while (!destroyed) {
		const msg = await a.read() // Blocks forever
		await b.write(msg)
	}
}
```

**Problems**: Blocking, CPU waste, complex error handling

### After (Event-Driven)

```typescript
export function createRelay(a: IoInterface, b: IoInterface) {
	a.onMessage = (msg) => b.write(msg) // A → B
	b.onMessage = (msg) => a.write(msg) // B → A
}
```

**Benefits**: Non-blocking, zero CPU when idle, clean composability

## Architecture

### Two Patterns Demonstrated

**1. Delegation Pattern** (Worker Section - explicit methods):

```typescript
worker: {
  add: (a, b) => workerAPI.add(a, b),
  multiply: (a, b) => workerAPI.multiply(a, b)
}
```

- Main knows method names
- Explicit forwarding
- Good for: Main intercepts/logs/modifies calls

**2. Proxy Pattern** (Stdio Section - transparent):

```typescript
stdio: new Proxy({} as StdioWorkerAPI, {
	get:
		(_, method) =>
		(...args) =>
			stdioAPI[method](...args)
})
```

- Main doesn't know method names
- Automatic forwarding
- Good for: Transparent relay, no Main involvement

## Benefits

1. **Event-Driven**: No polling, reactive to messages
2. **Composable**: Can chain relays: A → Relay → B → Relay → C
3. **Clean API**: One-line `createRelay(a, b)`
4. **Backward Compatible**: Existing code still works
5. **Type Safe**: Full TypeScript support

## Files Modified

- `packages/kkrpc/src/interface.ts` - Added onMessage property
- `packages/kkrpc/src/adapters/node.ts` - Event-driven support
- `packages/kkrpc/src/adapters/electron-ipc-main.ts` - Event-driven support
- `packages/kkrpc/src/relay.ts` - Complete rewrite with callbacks
- `examples/electron-demo/electron/main.ts` - Clean Proxy delegation

## Result

✅ All 6 tasks completed
✅ TypeScript compiles
✅ Demo works with both patterns
✅ Main.ts clean and maintainable
