/**
 * Standard Schema validation plugin for stable kkrpc.
 *
 * The plugin reuses the classic validation primitives but exposes them through
 * the stable plugin lifecycle. Input validation runs before the local method is
 * invoked, output validation runs after the method returns, and transformed
 * values are written back into the argument/result context.
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

import {
	RPCValidationError,
	defineAPI,
	defineMethod,
	extractValidators,
	isRPCValidationError,
	lookupValidator,
	runValidation,
	type InferAPI,
	type MethodValidators,
	type RPCValidators,
	type StandardSchemaV1
} from "../validation.ts"
import type { RPCPlugin, RPCRequestContext, RPCResponseContext } from "../core/plugins.ts"

export {
	RPCValidationError,
	defineAPI,
	defineMethod,
	extractValidators,
	isRPCValidationError,
	type InferAPI,
	type MethodValidators,
	type RPCValidators,
	type StandardSchemaV1
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
