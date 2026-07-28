import type { CompiledTimeline, CompiledTimelineEntry } from '../components/narration/types'
import compiledTimelineJson from '../narration/generated/timeline.json'

const EXPECTED_FPS = 30
const EXPECTED_WIDTH = 1920
const EXPECTED_HEIGHT = 1080

function fail(message: string): never {
	throw new Error(`Invalid compiled narration timeline: ${message}`)
}

function requireInteger(
	value: unknown,
	label: string,
	options: { positive?: boolean } = {}
): asserts value is number {
	if (!Number.isInteger(value)) fail(`${label} must be an integer`)
	if (options.positive ? Number(value) <= 0 : Number(value) < 0) {
		fail(`${label} must be ${options.positive ? 'positive' : 'non-negative'}`)
	}
}

function requireNonNegativeNumber(value: unknown, label: string): asserts value is number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		fail(`${label} must be a finite non-negative number`)
	}
}

function isSafePublicPath(value: string): boolean {
	if (
		value.length === 0 ||
		value.startsWith('/') ||
		value.startsWith('public/') ||
		value.includes('\\') ||
		/^[a-z][a-z0-9+.-]*:/i.test(value)
	) {
		return false
	}

	return value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
}

function validateEntry(entry: CompiledTimelineEntry, position: number): void {
	const label = `entries[${position}]`

	if (typeof entry !== 'object' || entry === null) fail(`${label} must be an object`)
	if (typeof entry.id !== 'string' || entry.id.length === 0) fail(`${label}.id must be non-empty`)
	requireInteger(entry.index, `${label}.index`)
	if (entry.index !== position) fail(`${label}.index must be ${position}`)
	requireInteger(entry.page, `${label}.page`, { positive: true })
	requireInteger(entry.click, `${label}.click`)
	if (typeof entry.text !== 'string') fail(`${label}.text must be a string`)

	requireNonNegativeNumber(entry.audioDurationMs, `${label}.audioDurationMs`)
	requireNonNegativeNumber(entry.silentMs, `${label}.silentMs`)
	requireNonNegativeNumber(entry.transitionMs, `${label}.transitionMs`)
	requireNonNegativeNumber(entry.leadInMs, `${label}.leadInMs`)
	requireNonNegativeNumber(entry.tailMs, `${label}.tailMs`)
	requireInteger(entry.transitionFrames, `${label}.transitionFrames`)
	requireInteger(entry.leadInFrames, `${label}.leadInFrames`)
	requireInteger(entry.audioFrames, `${label}.audioFrames`)
	requireInteger(entry.tailFrames, `${label}.tailFrames`)
	requireInteger(entry.startFrame, `${label}.startFrame`)
	requireInteger(entry.durationInFrames, `${label}.durationInFrames`, { positive: true })

	if (
		typeof entry.stateImagePublicPath !== 'string' ||
		!isSafePublicPath(entry.stateImagePublicPath)
	) {
		fail(`${label}.stateImagePublicPath must be a safe path relative to public/`)
	}

	if (entry.audioPublicPath === null) {
		if (entry.audioDurationMs !== 0) fail(`${label}.audioDurationMs must be 0 for a silent entry`)
	} else {
		if (typeof entry.audioPublicPath !== 'string' || !isSafePublicPath(entry.audioPublicPath)) {
			fail(`${label}.audioPublicPath must be null or a safe path relative to public/`)
		}
		if (entry.audioDurationMs <= 0) fail(`${label}.audioDurationMs must be positive`)
		if (entry.audioFrames <= 0) fail(`${label}.audioFrames must be positive`)
		if (entry.silentMs !== 0) fail(`${label}.audioPublicPath and silentMs are mutually exclusive`)
	}

	const phaseDuration =
		entry.transitionFrames + entry.leadInFrames + entry.audioFrames + entry.tailFrames
	if (entry.durationInFrames !== phaseDuration) {
		fail(`${label}.durationInFrames must equal its transition, lead-in, audio, and tail frames`)
	}
}

export function getEntryAudioStartFrame(
	entry: Pick<CompiledTimelineEntry, 'startFrame' | 'transitionFrames' | 'leadInFrames'>
): number {
	return entry.startFrame + entry.transitionFrames + entry.leadInFrames
}

export function validateCompiledTimeline(timeline: CompiledTimeline): void {
	if (typeof timeline !== 'object' || timeline === null) fail('root must be an object')
	if (timeline.version !== 1) fail('version must be 1')
	if (timeline.fps !== EXPECTED_FPS) fail(`fps must be ${EXPECTED_FPS}`)
	if (timeline.width !== EXPECTED_WIDTH || timeline.height !== EXPECTED_HEIGHT) {
		fail(`composition dimensions must be ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}`)
	}
	requireInteger(timeline.durationInFrames, 'durationInFrames', { positive: true })
	if (!Array.isArray(timeline.entries) || timeline.entries.length === 0) {
		fail('entries must be a non-empty array')
	}

	let expectedStartFrame = 0
	for (const [position, entry] of timeline.entries.entries()) {
		validateEntry(entry, position)
		if (entry.startFrame !== expectedStartFrame) {
			const expectation =
				position === 0 ? 'start at frame 0' : `be contiguous at frame ${expectedStartFrame}`
			fail(`entries[${position}] must ${expectation}, received ${entry.startFrame}`)
		}
		expectedStartFrame += entry.durationInFrames
	}

	if (timeline.durationInFrames !== expectedStartFrame) {
		fail(
			`durationInFrames must equal the contiguous entry duration ${expectedStartFrame}, received ${timeline.durationInFrames}`
		)
	}
}

// JSON imports do not preserve the literal interface; validate every field before exporting it.
export const timeline = compiledTimelineJson as CompiledTimeline
validateCompiledTimeline(timeline)
