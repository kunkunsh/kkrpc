/**
 * Optional runtime validation for kkrpc.
 *
 * Uses the Standard Schema interface (https://standardschema.dev) so any
 * compatible library works: Zod (v3.24+), Valibot (v1+), ArkType (v2+), etc.
 * kkrpc embeds the ~40-line Standard Schema TypeScript interface directly —
 * no `@standard-schema/spec` dependency is needed.
 *
 * Two usage patterns:
 *
 * 1. **Type-first** — define your API type and implementation as usual, then
 *    pass a `validators` map to RPCChannel that mirrors the API shape.
 *
 * 2. **Schema-first** — use `defineMethod()` / `defineAPI()` to define handlers
 *    with schemas inline. Types are inferred from the schemas. Use
 *    `extractValidators()` to collect the schemas for RPCChannel.
 */
import type { StandardSchemaV1 } from "./standard-schema.ts"

// Re-export for convenience so users can import from "kkrpc" directly
export type { StandardSchemaV1 } from "./standard-schema.ts"

// ---------------------------------------------------------------------------
// Type utilities for mapping API types → validator types
// ---------------------------------------------------------------------------

/**
 * Filter callback (function) arguments out of a parameter tuple type.
 *
 * kkrpc supports passing callback functions as RPC arguments — they are
 * serialized as `"__callback__<id>"` strings on the wire and restored to
 * real functions on the receiving side. These callbacks cannot be validated
 * by a schema, so we strip them from the expected input tuple.
 *
 * Example: `[string, number, (x: number) => void]` → `[string, number]`
 *
 * This type is used by `MethodValidators` to derive the correct schema type
 * for `input`. At runtime, `channel.ts` does the equivalent filtering with
 * `processedArgs.filter(a => typeof a !== "function")`.
 */
type FilterCallbacks<T extends any[]> = T extends [infer Head, ...infer Tail]
	? Head extends (...args: any[]) => any
		? FilterCallbacks<Tail>
		: [Head, ...FilterCallbacks<Tail>]
	: []

/** Unwrap `Promise<T>` to `T`; pass through non-Promise types unchanged. */
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T

/**
 * Validator definition for a single RPC method.
 *
 * - `input` — a Standard Schema that validates the arguments tuple.
 *   Callbacks are excluded (see `FilterCallbacks`), so for a method like
 *   `add(a: number, b: number)` the schema would be `z.tuple([z.number(), z.number()])`.
 *
 * - `output` — a Standard Schema that validates the return value
 *   (unwrapped from Promise), e.g. `z.number()` for `Promise<number>`.
 *
 * Both are optional — you can validate only inputs, only outputs, or both.
 */
export interface MethodValidators<Args extends any[] = any[], Return = any> {
	input?: StandardSchemaV1<FilterCallbacks<Args>, FilterCallbacks<Args>>
	output?: StandardSchemaV1<UnwrapPromise<Return>, UnwrapPromise<Return>>
}

/**
 * Recursively map an API type to its validator shape.
 *
 * Given an API like:
 * ```ts
 * type API = {
 *   add(a: number, b: number): Promise<number>
 *   math: { multiply(a: number, b: number): Promise<number> }
 * }
 * ```
 * This produces:
 * ```ts
 * {
 *   add?: { input?: StandardSchemaV1<[number, number]>, output?: StandardSchemaV1<number> }
 *   math?: { multiply?: { input?: ..., output?: ... } }
 * }
 * ```
 *
 * - Functions → `MethodValidators<Parameters, ReturnType>`
 * - Nested objects → recurse into `RPCValidators<NestedAPI>`
 * - Primitive properties / constructors → excluded (`never`)
 *
 * Every key is optional at every level, so you only validate what you want.
 */
export type RPCValidators<API> = {
	[K in keyof API]?: API[K] extends (...args: infer A) => infer R
		? MethodValidators<A, R>
		: API[K] extends Record<string, unknown>
			? RPCValidators<API[K]>
			: never
}

// ---------------------------------------------------------------------------
// RPCValidationError
// ---------------------------------------------------------------------------

/**
 * Error thrown when RPC validation fails.
 *
 * Custom properties (`phase`, `method`, `issues`) survive kkrpc's existing
 * `serializeError()` / `deserializeError()` round-trip because that code
 * copies all enumerable properties via `for (const key in error)`.
 *
 * On the caller side, use `isRPCValidationError()` to detect and narrow.
 */
export class RPCValidationError extends Error {
	/** Whether the input arguments or return value failed validation. */
	public readonly phase: "input" | "output"
	/** Dotted method path, e.g. "math.divide". */
	public readonly method: string
	/** Structured validation issues from the schema library. */
	public readonly issues: ReadonlyArray<StandardSchemaV1.Issue>

	constructor(
		phase: "input" | "output",
		method: string,
		issues: ReadonlyArray<StandardSchemaV1.Issue>
	) {
		const issueMessages = issues.map((i) => i.message).join("; ")
		super(`RPC ${phase} validation failed for "${method}": ${issueMessages}`)
		this.name = "RPCValidationError"
		this.phase = phase
		this.method = method
		this.issues = issues
	}
}

/**
 * Type guard for RPCValidationError.
 *
 * Checks `error.name` rather than `instanceof` because after serialization
 * over the wire, the error is reconstructed as a plain Error with custom
 * properties — not an actual RPCValidationError instance. Checking `.name`
 * works in both cases.
 */
export function isRPCValidationError(error: unknown): error is RPCValidationError {
	return error instanceof Error && error.name === "RPCValidationError"
}

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

/**
 * Look up the `MethodValidators` for a dotted method path (e.g. "math.grade1.add")
 * from a validators object that mirrors the API shape.
 *
 * The validators object has the same nesting as the API:
 * ```
 * { math: { grade1: { add: { input: ..., output: ... } } } }
 * ```
 * This function walks down the path segments and returns the leaf node
 * if it looks like a `MethodValidators` (has `input` or `output` key).
 * Returns `undefined` if the path doesn't exist or lands on a namespace
 * node (not a leaf with schemas).
 *
 * @param validators - The validators map (same shape as the API), or undefined
 * @param methodPath - Dotted method path, e.g. "add" or "math.grade1.add"
 */
export function lookupValidator(
	validators: Record<string, unknown> | undefined,
	methodPath: string
): MethodValidators | undefined {
	if (!validators) return undefined
	const parts = methodPath.split(".")
	let current: unknown = validators
	for (const part of parts) {
		if (!current || typeof current !== "object") return undefined
		current = (current as Record<string, unknown>)[part]
	}
	// A leaf MethodValidators node has `input` and/or `output` keys.
	// A namespace node (e.g. "math") is just a nested object without these keys.
	if (current && typeof current === "object" && ("input" in current || "output" in current)) {
		return current as MethodValidators
	}
	return undefined
}

/**
 * Execute a Standard Schema validator against a value.
 *
 * Calls `schema["~standard"].validate(value)` per the Standard Schema spec.
 * The spec requires `validate()` to return a `Result` object (never throw),
 * but we wrap in try-catch defensively in case a non-conforming validator
 * throws unexpectedly.
 *
 * @param schema - A Standard Schema instance (e.g. a Zod schema), or undefined to skip
 * @param value  - The value to validate (args tuple for input, return value for output)
 * @returns `{ success: true, value }` if valid (value may be transformed/coerced by the schema),
 *          or `{ success: false, issues }` with structured validation issues
 */
export async function runValidation(
	schema: StandardSchemaV1 | undefined,
	value: unknown
): Promise<
	| { success: true; value: unknown }
	| { success: false; issues: ReadonlyArray<StandardSchemaV1.Issue> }
> {
	if (!schema) return { success: true, value }
	try {
		const result = await schema["~standard"].validate(value)
		if (result.issues) {
			return { success: false, issues: result.issues }
		}
		return { success: true, value: result.value }
	} catch (error) {
		// Standard Schema spec says validate() should never throw, but we handle
		// it gracefully in case of a non-conforming validator implementation.
		return {
			success: false,
			issues: [{ message: `Validator threw: ${error}` }]
		}
	}
}

// ---------------------------------------------------------------------------
// Schema-first helpers: defineMethod / defineAPI / extractValidators
// ---------------------------------------------------------------------------

/** Schema pair accepted by `defineMethod`. Both input and output are required. */
export interface MethodSchemaConfig<
	InputSchema extends StandardSchemaV1<any, any>,
	OutputSchema extends StandardSchemaV1<any, any>
> {
	input: InputSchema
	output: OutputSchema
}

/**
 * Non-enumerable property key used to attach validator metadata to handler
 * functions created by `defineMethod()`. The `~` prefix follows the Standard
 * Schema convention for "private" metadata keys. `extractValidators()` reads
 * this key to collect schemas into an RPCValidators map.
 */
const VALIDATORS_KEY = "~validators" as const

/**
 * The type of a function created by `defineMethod()`.
 *
 * It is both callable (the handler) and carries `~validators` metadata.
 * The function signature is inferred from the schemas:
 * - If the input schema's output type is a tuple, args are spread
 * - Otherwise the schema output is wrapped in a single-element tuple
 *
 * `extractValidators()` reads the `[~validators]` property to build the
 * validators map that RPCChannel needs.
 */
export interface DefinedMethod<
	InputSchema extends StandardSchemaV1<any, any>,
	OutputSchema extends StandardSchemaV1<any, any>
> {
	(
		...args: StandardSchemaV1.InferOutput<InputSchema> extends readonly any[]
			? StandardSchemaV1.InferOutput<InputSchema>
			: [StandardSchemaV1.InferOutput<InputSchema>]
	): Promise<StandardSchemaV1.InferOutput<OutputSchema>>

	readonly [VALIDATORS_KEY]: {
		input: InputSchema
		output: OutputSchema
	}
}

/**
 * Define a single RPC method with schema-first validation.
 * Types are **inferred** from the schemas — no separate type definition needed.
 *
 * @example
 * ```ts
 * const echo = defineMethod(
 *   { input: z.tuple([z.string()]), output: z.string() },
 *   async (message) => message
 * )
 * ```
 */
export function defineMethod<
	InputSchema extends StandardSchemaV1<any, any>,
	OutputSchema extends StandardSchemaV1<any, any>
>(
	schemas: MethodSchemaConfig<InputSchema, OutputSchema>,
	handler: (
		...args: StandardSchemaV1.InferOutput<InputSchema> extends readonly any[]
			? StandardSchemaV1.InferOutput<InputSchema>
			: [StandardSchemaV1.InferOutput<InputSchema>]
	) => Promise<StandardSchemaV1.InferOutput<OutputSchema>>
): DefinedMethod<InputSchema, OutputSchema> {
	// Attach schemas as a non-enumerable property so they don't interfere with
	// normal usage (e.g. Object.keys, JSON.stringify) but are accessible to
	// `extractValidators()`. We use `Object.defineProperty` to avoid `as any`.
	Object.defineProperty(handler, VALIDATORS_KEY, {
		value: { input: schemas.input, output: schemas.output },
		enumerable: false,
		writable: false
	})
	return handler as DefinedMethod<InputSchema, OutputSchema>
}

/**
 * Define a complete API with schema-first validation.
 * Identity function — returns the object as-is but enables `InferAPI<typeof api>`.
 *
 * @example
 * ```ts
 * const api = defineAPI({
 *   echo: defineMethod({ input: z.tuple([z.string()]), output: z.string() }, async (msg) => msg),
 *   math: {
 *     add: defineMethod({ input: z.tuple([z.number(), z.number()]), output: z.number() }, async (a, b) => a + b),
 *   }
 * })
 * ```
 */
export function defineAPI<T extends Record<string, unknown>>(api: T): T {
	return api
}

/**
 * Walk a `defineAPI()` result and collect `~validators` metadata from
 * `defineMethod()` handlers into an `RPCValidators`-shaped object.
 *
 * For each key in the API object:
 * - If it's a function with `~validators` metadata → extract the schemas
 * - If it's a plain object (namespace) → recurse into it
 * - If it's a Standard Schema object (has `~standard`) → skip it
 *   (this prevents treating schema objects as namespace nodes)
 * - Plain functions without metadata are skipped (no validation for them)
 *
 * The result can be passed directly to `RPCChannel`'s `validators` option.
 */
export function extractValidators<T extends Record<string, unknown>>(
	api: T
): Record<string, unknown> {
	const validators: Record<string, unknown> = {}
	for (const key of Object.keys(api)) {
		const value = api[key]
		if (typeof value === "function" && VALIDATORS_KEY in value) {
			// This is a defineMethod() handler — extract its schema metadata
			validators[key] = (value as Record<string, unknown>)[VALIDATORS_KEY]
		} else if (typeof value === "object" && value !== null && !("~standard" in value)) {
			// This is a namespace object (e.g. { math: { add: defineMethod(...) } }).
			// The `~standard` check prevents descending into Standard Schema objects,
			// which are also plain objects but should not be treated as API namespaces.
			const nested = extractValidators(value as Record<string, unknown>)
			if (Object.keys(nested).length > 0) {
				validators[key] = nested
			}
		}
	}
	return validators
}

// ---------------------------------------------------------------------------
// Type utilities
// ---------------------------------------------------------------------------

/**
 * Infer the plain API type from a `defineAPI()` result.
 *
 * `defineAPI()` returns an object where methods are `DefinedMethod` instances
 * (functions with `~validators` metadata). The client side doesn't know about
 * `DefinedMethod` — it just needs the plain function signatures. This type
 * strips the metadata and produces a clean API type suitable for
 * `RPCChannel<{}, InferAPI<typeof api>>`.
 *
 * - `DefinedMethod` → plain async function with inferred arg/return types
 * - Nested `Record<string, unknown>` → recurse
 * - Everything else → pass through unchanged
 */
export type InferAPI<T> = {
	[K in keyof T]: T[K] extends DefinedMethod<infer I, infer O>
		? (
				...args: StandardSchemaV1.InferOutput<I> extends readonly any[]
					? StandardSchemaV1.InferOutput<I>
					: [StandardSchemaV1.InferOutput<I>]
			) => Promise<StandardSchemaV1.InferOutput<O>>
		: T[K] extends Record<string, unknown>
			? InferAPI<T[K]>
			: T[K]
}
