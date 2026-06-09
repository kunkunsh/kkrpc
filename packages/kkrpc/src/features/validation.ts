/**
 * Standard Schema validation plugin for stable kkrpc.
 *
 * The plugin defines Standard Schema validation primitives for the stable plugin
 * lifecycle. Input validation runs before the local method is invoked, output
 * validation runs after the method returns, and transformed values are written
 * back into the argument/result context.
 *
 * This module is intentionally separate from `kkrpc` so importing the core
 * channel does not pull validation helpers or schema-library related code into
 * small browser bundles.
 *
 * @example
 * ```ts
 * import { expose } from "kkrpc"
 * import { validationPlugin, defineAPI, defineMethod } from "kkrpc/validation"
 * import { z } from "zod"
 *
 * const validators = defineAPI({
 * 	add: defineMethod({
 * 		input: z.tuple([z.number(), z.number()]),
 * 		output: z.number()
 * 	})
 * })
 *
 * expose(api, transport, { plugins: [validationPlugin(validators)] })
 * ```
 */

import type { RPCPlugin, RPCRequestContext, RPCResponseContext } from "../core/plugins.ts"

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

export interface MethodValidators<Args extends unknown[] = unknown[], Return = unknown> {
	input?: StandardSchemaV1<FilterCallbacks<Args>, FilterCallbacks<Args>>
	output?: StandardSchemaV1<UnwrapPromise<Return>, UnwrapPromise<Return>>
}

export type RPCValidators<API> = {
	[K in keyof API]?: API[K] extends (...args: infer A) => infer R
		? MethodValidators<A, R>
		: API[K] extends Record<string, unknown>
			? RPCValidators<API[K]>
			: never
}

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

export function isRPCValidationError(error: unknown): error is RPCValidationError {
	return error instanceof Error && error.name === "RPCValidationError"
}

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

export interface MethodSchemaConfig<
	InputSchema extends StandardSchemaV1<unknown, unknown>,
	OutputSchema extends StandardSchemaV1<unknown, unknown>
> {
	input: InputSchema
	output: OutputSchema
}

const VALIDATORS_KEY = "~validators" as const

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

export function defineAPI<T extends Record<string, unknown>>(api: T): T {
	return api
}

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
 * Callback arguments are ignored for input validation because schemas validate
 * serializable values, not callback function placeholders. If a schema returns
 * transformed values, those values replace the original non-callback arguments
 * before the exposed method is called.
 */
export function validationPlugin<API extends object>(validators: RPCValidators<API> | undefined): RPCPlugin
export function validationPlugin(validators: Record<string, unknown> | undefined): RPCPlugin
export function validationPlugin(validators: Record<string, unknown> | undefined): RPCPlugin {
	return {
		name: "validation",
		onRequest: (ctx) => validateInput(validators, ctx),
		onResponse: (ctx) => validateOutput(validators, ctx)
	}
}
