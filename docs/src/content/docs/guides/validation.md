---
title: Data Validation
description: Optional runtime validation of RPC inputs and outputs using Zod, Valibot, ArkType, or any Standard Schema library
sidebar:
  order: 4
---

kkrpc supports optional runtime validation of RPC inputs and outputs. Validation uses the [Standard Schema](https://standardschema.dev) interface, which is implemented by Zod (v3.24+), Valibot (v1+), ArkType (v2+), and many other libraries. No additional kkrpc dependencies are required — bring your own validator.

Validation is fully opt-in. Without it, kkrpc behaves exactly as before.

## How It Works

1. You provide a `validators` map when creating an RPCChannel
2. The validators map mirrors your API shape — each method can have `input` and/or `output` schemas
3. When a call is received, kkrpc validates the arguments before invoking the handler
4. After the handler returns, kkrpc validates the result before sending it back
5. If validation fails, the caller receives an `RPCValidationError` with structured issue details

Since kkrpc is bidirectional, both sides can independently have validators for their own exposed API. Whichever side receives a call validates against its own schemas.

## Approach 1: Type-first (validators option)

This approach works with existing code — define your API types and implementation as usual, then add a `validators` map:

```ts
import { z } from "zod"
import { RPCChannel, type RPCValidators } from "kkrpc"

// 1. Define your API type (existing code, no changes needed)
type API = {
  echo(message: string): Promise<string>
  add(a: number, b: number): Promise<number>
  createUser(user: { name: string; email: string }): Promise<{ id: string; name: string; email: string }>
  math: {
    multiply(a: number, b: number): Promise<number>
    divide(a: number, b: number): Promise<number>
  }
}

// 2. Implement the API (existing code, no changes needed)
const api: API = {
  echo: async (message) => message,
  add: async (a, b) => a + b,
  createUser: async (user) => ({ id: "123", ...user }),
  math: {
    multiply: async (a, b) => a * b,
    divide: async (a, b) => a / b
  }
}

// 3. Define validators — mirrors the API shape
const validators: RPCValidators<API> = {
  echo: {
    input: z.tuple([z.string()]),
    output: z.string()
  },
  add: {
    input: z.tuple([z.number(), z.number()]),
    output: z.number()
  },
  createUser: {
    input: z.tuple([z.object({
      name: z.string().min(1),
      email: z.string().email()
    })]),
    output: z.object({ id: z.string(), name: z.string(), email: z.string() })
  },
  math: {
    multiply: {
      input: z.tuple([z.number(), z.number()]),
      output: z.number()
    },
    divide: {
      input: z.tuple([
        z.number(),
        z.number().refine((n) => n !== 0, "Divisor cannot be zero")
      ]),
      output: z.number()
    }
  }
}

// 4. Pass validators to RPCChannel
new RPCChannel(io, { expose: api, validators })
```

### Key points

- **Input schemas use `z.tuple()`** to match function argument lists — `add(a: number, b: number)` becomes `z.tuple([z.number(), z.number()])`
- **Every key is optional** — validate only the methods you care about, skip the rest
- **Nested APIs** like `math.multiply` are naturally represented as nested objects in the validators map
- **Refinements** like `.email()`, `.min(1)`, `.refine()` work as expected

## Approach 2: Schema-first (defineMethod + defineAPI)

For users who want types inferred from schemas (similar to tRPC), use `defineMethod` and `defineAPI`:

```ts
import { z } from "zod"
import {
  RPCChannel,
  defineMethod,
  defineAPI,
  extractValidators,
  type InferAPI
} from "kkrpc"

// Define API with schemas — types are inferred automatically
const api = defineAPI({
  greet: defineMethod(
    { input: z.tuple([z.string()]), output: z.string() },
    async (name) => `Hello, ${name}!` // name is typed as string
  ),
  math: {
    add: defineMethod(
      { input: z.tuple([z.number(), z.number()]), output: z.number() },
      async (a, b) => a + b // a, b typed as number
    )
  }
})

// Extract the plain API type for the client side
type MyAPI = InferAPI<typeof api>

// extractValidators() collects schema metadata from defineMethod calls
new RPCChannel(io, {
  expose: api,
  validators: extractValidators(api)
})
```

### When to use which approach

| | Type-first (validators option) | Schema-first (defineMethod) |
|---|---|---|
| **Best for** | Adding validation to existing APIs | New APIs where you want single source of truth |
| **Types come from** | Your `type API = { ... }` declaration | Schema inference (`InferAPI<typeof api>`) |
| **Validator definition** | Separate `RPCValidators<API>` object | Inline with `defineMethod()` |
| **Refactoring cost** | Zero — existing code unchanged | Requires wrapping handlers with `defineMethod` |

## Handling Validation Errors

When validation fails, the caller receives an `RPCValidationError`:

```ts
import { isRPCValidationError } from "kkrpc"

try {
  await api.add("not", "numbers")
} catch (error) {
  if (isRPCValidationError(error)) {
    console.log(error.phase)   // "input" or "output"
    console.log(error.method)  // "add"
    console.log(error.issues)  // [{ message: "Expected number, received string", path: [0] }]
  }
}
```

### RPCValidationError properties

| Property | Type | Description |
|---|---|---|
| `phase` | `"input" \| "output"` | Whether the input arguments or return value failed |
| `method` | `string` | Dotted method path (e.g. `"math.divide"`) |
| `issues` | `Array<{ message: string; path?: Array }>` | Structured validation issues from the schema library |
| `name` | `string` | Always `"RPCValidationError"` |
| `message` | `string` | Human-readable summary |

### Error serialization

`RPCValidationError` survives kkrpc's error serialization automatically — all custom properties (`phase`, `method`, `issues`) are preserved across the wire. The `isRPCValidationError()` type guard works on both the original error and the deserialized version.

## Examples

### Rejecting invalid email

```ts
const validators: RPCValidators<API> = {
  createUser: {
    input: z.tuple([z.object({
      name: z.string().min(1),
      email: z.string().email()
    })])
  }
}

// This will throw RPCValidationError with phase "input"
await api.createUser({ name: "Bob", email: "not-an-email" })
```

### Catching bad return types (output validation)

```ts
const validators = {
  getName: { output: z.string() }
}

// If the handler returns a number instead of a string,
// the caller receives RPCValidationError with phase "output"
```

### Division by zero with custom refinement

```ts
const validators: RPCValidators<API> = {
  math: {
    divide: {
      input: z.tuple([
        z.number(),
        z.number().refine((n) => n !== 0, "Divisor cannot be zero")
      ])
    }
  }
}

try {
  await api.math.divide(10, 0)
} catch (error) {
  if (isRPCValidationError(error)) {
    // error.issues[0].message === "Divisor cannot be zero"
  }
}
```

### No validators (backward compatible)

```ts
// Existing code works exactly as before — no validators, no validation
new RPCChannel(io, { expose: api })
```

## Standard Schema Compatibility

kkrpc uses the [Standard Schema](https://standardschema.dev) interface internally. This means any library that implements the `~standard` protocol works out of the box:

- **Zod** (v4+) — most popular
- **Valibot** (v1+) — lightweight alternative
- **ArkType** (v2+) — type-first validation
- And [many more](https://standardschema.dev/#what-schema-libraries-implement-the-spec)

kkrpc embeds the Standard Schema TypeScript interface (~40 lines) directly — no `@standard-schema/spec` dependency needed.

## API Reference

### Types

- `RPCValidators<API>` — recursively maps an API type to its validator shape
- `MethodValidators<Args, Return>` — `{ input?: StandardSchemaV1, output?: StandardSchemaV1 }`
- `RPCValidationError` — error class with `phase`, `method`, `issues`
- `InferAPI<T>` — extracts the plain API type from a `defineAPI()` result

### Functions

- `lookupValidator(validators, methodPath)` — resolves a dotted path like `"math.divide"` to its `MethodValidators`
- `runValidation(schema, value)` — executes a Standard Schema validator, returns `{ success, value }` or `{ success, issues }`
- `defineMethod(schemas, handler)` — creates a handler function with schema metadata attached
- `defineAPI(api)` — identity function that enables `InferAPI<typeof api>` type inference
- `extractValidators(api)` — walks a `defineAPI()` result and collects schema metadata into an `RPCValidators` object
- `isRPCValidationError(error)` — type guard that works across serialization boundaries
