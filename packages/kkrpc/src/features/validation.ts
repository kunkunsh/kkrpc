/**
 * Standard Schema validation plugin for stable kkrpc.
 *
 * Standard Schema is a common interface implemented by schema libraries such as
 * Zod, Valibot, and ArkType. kkrpc can use those schemas in either a type-first
 * style, where validators are supplied beside an existing API type, or a
 * schema-first style, where `defineMethod()` attaches schemas to the API
 * implementation and `extractValidators()` reads them back out.
 *
 * Input validation runs before the local method is invoked, output validation
 * runs after the method returns, and transformed values are written back into the
 * argument/result context. Validation failures throw `RPCValidationError`, which
 * preserves the phase, method name, and Standard Schema issues.
 *
 * Use `validationPlugin()` when exposing an API to validate receive-side calls:
 *
 * ```ts
 * import { expose } from "kkrpc"
 * import { validationPlugin, type ValidatorMap } from "kkrpc/validation"
 * import { z } from "zod"
 *
 * interface MathAPI {
 * 	add(a: number, b: number): Promise<number>
 * }
 *
 * const validators: ValidatorMap<MathAPI> = {
 * 	add: {
 * 		input: z.tuple([z.number(), z.number()]),
 * 		output: z.number()
 * 	}
 * }
 *
 * expose(api, transport, { plugins: [validationPlugin(validators)] })
 * ```
 */

import type { RPCPlugin, RPCRequestContext, RPCResponseContext } from "../core/plugins.ts"

/**
 * Minimal Standard Schema v1 interface accepted by kkrpc validation helpers.
 *
 * Any library that exposes the `~standard` property can be used as an input or
 * output schema. kkrpc only depends on `validate()` and the optional static
 * `types` metadata used for TypeScript inference.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
	readonly "~standard": StandardSchemaV1.Props<Input, Output>
}

export declare namespace StandardSchemaV1 {
	interface Props<Input = unknown, Output = Input> {
		readonly version: 1
		readonly vendor: string
		readonly validate: (
			value: unknown,
			options?: Options | undefined
		) => Result<Output> | Promise<Result<Output>>
		readonly types?: Types<Input, Output> | undefined
	}

	type Result<Output> = SuccessResult<Output> | FailureResult

	interface SuccessResult<Output> {
		readonly value: Output
		readonly issues?: undefined
	}

	interface FailureResult {
		readonly issues: ReadonlyArray<Issue>
	}

	interface Options {
		readonly libraryOptions?: Record<string, unknown> | undefined
	}

	interface Issue {
		readonly message: string
		readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined
	}

	interface PathSegment {
		readonly key: PropertyKey
	}

	interface Types<Input = unknown, Output = Input> {
		readonly input: Input
		readonly output: Output
	}

	type InferInput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["input"]
	type InferOutput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["output"]
}

type FilterCallbacks<T extends unknown[]> = T extends [infer Head, ...infer Tail]
	? Head extends (...args: unknown[]) => unknown
		? FilterCallbacks<Tail>
		: [Head, ...FilterCallbacks<Tail>]
	: []

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T

/**
 * Input and output schemas for one RPC method.
 *
 * Callback arguments are filtered out before input validation, so `input`
 * schemas should describe only serializable arguments. `output` schemas validate
 * the awaited return value.
 */
export interface MethodValidators<Args extends unknown[] = unknown[], Return = unknown> {
	input?: StandardSchemaV1<FilterCallbacks<Args>, FilterCallbacks<Args>>
	output?: StandardSchemaV1<UnwrapPromise<Return>, UnwrapPromise<Return>>
}

/**
 * Type-first validator map for an existing API surface.
 *
 * Keys mirror the exposed API object. Method leaves hold `MethodValidators`, and
 * nested objects hold nested validator maps.
 *
 * Type-first usage:
 *
 * ```ts
 * import { expose } from "kkrpc"
 * import { validationPlugin, type ValidatorMap } from "kkrpc/validation"
 * import { z } from "zod"
 *
 * interface MathAPI {
 * 	add(a: number, b: number): Promise<number>
 * }
 *
 * const validators: ValidatorMap<MathAPI> = {
 * 	add: {
 * 		input: z.tuple([z.number(), z.number()]),
 * 		output: z.number()
 * 	}
 * }
 *
 * expose(api, transport, { plugins: [validationPlugin<MathAPI>(validators)] })
 * ```
 *
 * Schema-first usage builds the validator map from methods created with
 * `defineMethod()`:
 *
 * ```ts
 * const api = defineAPI({
 * 	add: defineMethod(
 * 		{ input: z.tuple([z.number(), z.number()]), output: z.number() },
 * 		async (a, b) => a + b
 * 	)
 * })
 *
 * expose(api, transport, { plugins: [validationPlugin(extractValidators(api))] })
 * ```
 */
export type ValidatorMap<API> = {
	[K in keyof API]?: API[K] extends (...args: infer A) => infer R
		? MethodValidators<A, R>
		: API[K] extends Record<string, unknown>
			? ValidatorMap<API[K]>
			: never
}

/**
 * Error thrown when input or output validation fails.
 *
 * The error message includes the failing phase and method. Inspect `phase`,
 * `method`, and `issues` when converting validation failures into application
 * errors or transport-level responses.
 */
export class RPCValidationError extends Error {
	public readonly phase: "input" | "output"
	public readonly method: string
	public readonly issues: ReadonlyArray<StandardSchemaV1.Issue>

	constructor(
		phase: "input" | "output",
		method: string,
		issues: ReadonlyArray<StandardSchemaV1.Issue>
	) {
		const issueMessages = issues.map((issue) => issue.message).join("; ")
		super(`RPC ${phase} validation failed for "${method}": ${issueMessages}`)
		this.name = "RPCValidationError"
		this.phase = phase
		this.method = method
		this.issues = issues
	}
}

/** Return true when an unknown error is an `RPCValidationError`. */
export function isRPCValidationError(error: unknown): error is RPCValidationError {
	return error instanceof Error && error.name === "RPCValidationError"
}

/**
 * Find validators for a dot-joined method path in a nested validator map.
 *
 * For example, `"users.create"` looks up `validators.users.create` and returns
 * it only when that leaf has an `input` or `output` schema.
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
	if (current && typeof current === "object" && ("input" in current || "output" in current)) {
		return current as MethodValidators
	}
	return undefined
}

/**
 * Execute a Standard Schema validator and normalize success or failure.
 *
 * Missing schemas are treated as pass-through success. Validator exceptions are
 * reported as validation issues instead of escaping as raw library errors.
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
		if (result.issues) return { success: false, issues: result.issues }
		return { success: true, value: result.value }
	} catch (error) {
		return { success: false, issues: [{ message: `Validator threw: ${error}` }] }
	}
}

/** Schema pair used by `defineMethod()` for schema-first APIs. */
export interface MethodSchemaConfig<
	InputSchema extends StandardSchemaV1<unknown, unknown>,
	OutputSchema extends StandardSchemaV1<unknown, unknown>
> {
	input: InputSchema
	output: OutputSchema
}

const VALIDATORS_KEY = "~validators" as const

/**
 * Function type returned by `defineMethod()`.
 *
 * The function keeps the implementation signature inferred from the input and
 * output schemas and stores its schema pair on a non-enumerable marker consumed
 * by `extractValidators()`.
 */
export interface DefinedMethod<
	InputSchema extends StandardSchemaV1<unknown, unknown>,
	OutputSchema extends StandardSchemaV1<unknown, unknown>
> {
	(
		...args: StandardSchemaV1.InferOutput<InputSchema> extends readonly unknown[]
			? StandardSchemaV1.InferOutput<InputSchema>
			: [StandardSchemaV1.InferOutput<InputSchema>]
	): Promise<StandardSchemaV1.InferOutput<OutputSchema>>

	readonly [VALIDATORS_KEY]: {
		input: InputSchema
		output: OutputSchema
	}
}

/**
 * Attach Standard Schema validators to a method implementation.
 *
 * This is the schema-first API: schemas define the callable TypeScript surface,
 * `defineAPI()` preserves the object shape, `extractValidators()` builds the
 * runtime validator map, and `InferAPI` derives the remote API type.
 *
 * Schema-first usage:
 *
 * ```ts
 * import { expose, wrap } from "kkrpc"
 * import {
 * 	defineAPI,
 * 	defineMethod,
 * 	extractValidators,
 * 	type InferAPI,
 * 	validationPlugin
 * } from "kkrpc/validation"
 * import { z } from "zod"
 *
 * const api = defineAPI({
 * 	add: defineMethod(
 * 		{ input: z.tuple([z.number(), z.number()]), output: z.number() },
 * 		async (a, b) => a + b
 * 	)
 * })
 *
 * expose(api, transport, { plugins: [validationPlugin(extractValidators(api))] })
 * const remote = wrap<InferAPI<typeof api>>(clientTransport)
 * ```
 *
 * Type-first usage keeps method implementations plain and provides a separate
 * `ValidatorMap<API>` directly to `validationPlugin()`:
 *
 * ```ts
 * const validators: ValidatorMap<MathAPI> = {
 * 	add: { input: z.tuple([z.number(), z.number()]), output: z.number() }
 * }
 *
 * expose(api, transport, { plugins: [validationPlugin<MathAPI>(validators)] })
 * ```
 */
export function defineMethod<
	InputSchema extends StandardSchemaV1<unknown, unknown>,
	OutputSchema extends StandardSchemaV1<unknown, unknown>
>(
	schemas: MethodSchemaConfig<InputSchema, OutputSchema>,
	handler: (
		...args: StandardSchemaV1.InferOutput<InputSchema> extends readonly unknown[]
			? StandardSchemaV1.InferOutput<InputSchema>
			: [StandardSchemaV1.InferOutput<InputSchema>]
	) => Promise<StandardSchemaV1.InferOutput<OutputSchema>>
): DefinedMethod<InputSchema, OutputSchema> {
	Object.defineProperty(handler, VALIDATORS_KEY, {
		value: { input: schemas.input, output: schemas.output },
		enumerable: false,
		writable: false
	})
	return handler as DefinedMethod<InputSchema, OutputSchema>
}

/** Preserve an API object's schema-first shape for inference. */
export function defineAPI<T extends Record<string, unknown>>(api: T): T {
	return api
}

/**
 * Extract a nested validator map from a schema-first API object.
 *
 * Methods created by `defineMethod()` contribute their hidden validator pairs.
 * Plain nested objects are traversed recursively.
 */
export function extractValidators<T extends Record<string, unknown>>(
	api: T
): Record<string, unknown> {
	const validators: Record<string, unknown> = {}
	for (const key of Object.keys(api)) {
		const value = api[key]
		if (typeof value === "function" && VALIDATORS_KEY in value) {
			validators[key] = (value as Record<string, unknown>)[VALIDATORS_KEY]
		} else if (typeof value === "object" && value !== null && !("~standard" in value)) {
			const nested = extractValidators(value as Record<string, unknown>)
			if (Object.keys(nested).length > 0) validators[key] = nested
		}
	}
	return validators
}

/**
 * Infer the callable remote API type from a schema-first API definition.
 *
 * `DefinedMethod` entries become methods returning promises of the output schema
 * type, while nested objects are inferred recursively.
 */
export type InferAPI<T> = {
	[K in keyof T]: T[K] extends DefinedMethod<infer I, infer O>
		? (
				...args: StandardSchemaV1.InferOutput<I> extends readonly unknown[]
					? StandardSchemaV1.InferOutput<I>
					: [StandardSchemaV1.InferOutput<I>]
			) => Promise<StandardSchemaV1.InferOutput<O>>
		: T[K] extends Record<string, unknown>
			? InferAPI<T[K]>
			: T[K]
}

function filterCallbacks(args: unknown[]): unknown[] {
	return args.filter((arg) => typeof arg !== "function")
}

function mergeValidatedArgs(original: unknown[], validated: unknown): unknown[] {
	const validatedValues = Array.isArray(validated) ? validated : [validated]
	const result = [...original]
	let nextValidated = 0
	for (let index = 0; index < result.length; index++) {
		if (typeof result[index] === "function") continue
		if (nextValidated < validatedValues.length) result[index] = validatedValues[nextValidated++]
	}
	return result
}

async function validateInput(
	validators: Record<string, unknown> | undefined,
	ctx: RPCRequestContext
): Promise<void> {
	if (ctx.operation !== "call" && ctx.operation !== "new") return
	const methodValidators = lookupValidator(validators, ctx.method)
	const result = await runValidation(methodValidators?.input, filterCallbacks(ctx.args))
	if (!result.success) throw new RPCValidationError("input", ctx.method, result.issues)
	ctx.args = mergeValidatedArgs(ctx.args, result.value)
}

async function validateOutput(
	validators: Record<string, unknown> | undefined,
	ctx: RPCResponseContext
): Promise<void> {
	if (ctx.operation !== "call" && ctx.operation !== "new") return
	const methodValidators = lookupValidator(validators, ctx.method)
	const result = await runValidation(methodValidators?.output, ctx.result)
	if (!result.success) throw new RPCValidationError("output", ctx.method, result.issues)
	ctx.result = result.value
}

/**
 * Create a receive-side plugin that validates method input and output.
 *
 * Type-first usage passes a `ValidatorMap<API>` for an existing API type:
 *
 * ```ts
 * import { expose } from "kkrpc"
 * import { validationPlugin, type ValidatorMap } from "kkrpc/validation"
 * import { z } from "zod"
 *
 * interface MathAPI {
 * 	add(a: number, b: number): Promise<number>
 * }
 *
 * const validators: ValidatorMap<MathAPI> = {
 * 	add: { input: z.tuple([z.number(), z.number()]), output: z.number() }
 * }
 *
 * expose(api, transport, { plugins: [validationPlugin<MathAPI>(validators)] })
 * ```
 *
 * Schema-first usage extracts validators from methods created with
 * `defineMethod()`:
 *
 * ```ts
 * import { expose } from "kkrpc"
 * import { defineAPI, defineMethod, extractValidators, validationPlugin } from "kkrpc/validation"
 * import { z } from "zod"
 *
 * const api = defineAPI({
 * 	add: defineMethod(
 * 		{ input: z.tuple([z.number(), z.number()]), output: z.number() },
 * 		async (a, b) => a + b
 * 	)
 * })
 *
 * expose(api, transport, { plugins: [validationPlugin(extractValidators(api))] })
 * ```
 *
 * Callback arguments are ignored for input validation because schemas validate
 * serializable values, not callback function placeholders. If a schema returns
 * transformed values, those values replace the original non-callback arguments
 * before the exposed method is called.
 */
export function validationPlugin<API extends object>(
	validators: ValidatorMap<API> | undefined
): RPCPlugin
/** Create a validation plugin from an untyped validator map. */
export function validationPlugin(validators: Record<string, unknown> | undefined): RPCPlugin
export function validationPlugin(validators: Record<string, unknown> | undefined): RPCPlugin {
	return {
		name: "validation",
		onRequest: (ctx) => validateInput(validators, ctx),
		onResponse: (ctx) => validateOutput(validators, ctx)
	}
}
