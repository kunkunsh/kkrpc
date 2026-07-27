import { z } from 'zod'

const timingSchema = z.number().int().min(0).max(60_000)

const segmentSchema = z
	.object({
		id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/),
		click: z.number().int().min(0),
		text: z.string(),
		audio: z.string().min(1).optional(),
		silentMs: z.number().int().positive().optional(),
		transitionMs: timingSchema.optional(),
		leadInMs: timingSchema.optional(),
		tailMs: timingSchema.optional()
	})
	.superRefine((segment, context) => {
		if ((segment.audio === undefined) === (segment.silentMs === undefined)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'exactly one of audio or silentMs is required'
			})
		}
	})

const manifestSchema = z.object({
	version: z.literal(1),
	defaults: z.object({
		transitionMs: timingSchema,
		leadInMs: timingSchema,
		tailMs: timingSchema
	}),
	slides: z
		.array(
			z.object({
				page: z.number().int().positive(),
				segments: z.array(segmentSchema).min(1)
			})
		)
		.min(1)
})

export type NarrationManifest = z.infer<typeof manifestSchema>
export type NarrationSegment = z.infer<typeof segmentSchema>

export function validateManifest(input: unknown): NarrationManifest {
	const manifest = manifestSchema.parse(input)
	const ids = new Set<string>()
	const pages = new Set<number>()

	for (const slide of manifest.slides) {
		if (pages.has(slide.page)) throw new Error(`duplicate slide page: ${slide.page}`)
		pages.add(slide.page)

		if (slide.segments[0].click !== 0)
			throw new Error(`slide ${slide.page} must start with click 0`)

		let previousClick = -1
		for (const segment of slide.segments) {
			if (segment.click <= previousClick)
				throw new Error(`slide ${slide.page} clicks must be strictly increasing`)
			if (ids.has(segment.id)) throw new Error(`duplicate segment id: ${segment.id}`)
			ids.add(segment.id)
			previousClick = segment.click
		}
	}

	return manifest
}
