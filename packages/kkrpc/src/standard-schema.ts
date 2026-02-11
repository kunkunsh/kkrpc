/**
 * Standard Schema V1 interface (https://standardschema.dev)
 * Embedded per spec recommendation — no external dependency required.
 * Compatible with Zod v3.24+, Valibot v1+, ArkType v2+.
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

	/** Extract the input type from a Standard Schema. */
	type InferInput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["input"]

	/** Extract the output type from a Standard Schema. */
	type InferOutput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["output"]
}
