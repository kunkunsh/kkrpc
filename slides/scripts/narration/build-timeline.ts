import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import type { CompiledTimeline, CompiledTimelineEntry } from '../../components/narration/types'
import { probeAudioDurationMs } from './probe-audio'
import {
	generatedDirectory,
	generatedTimelinePath,
	narrationSourcePath,
	publicDirectory
} from './paths'
import { type NarrationManifest, validateManifest } from './schema'

const FPS = 30

export function millisecondsToFrames(milliseconds: number, fps: number): number {
	if (!Number.isFinite(milliseconds) || milliseconds < 0) {
		throw new RangeError('milliseconds must be a non-negative finite number')
	}
	if (!Number.isFinite(fps) || fps <= 0) throw new RangeError('fps must be a positive finite number')

	return Math.round((milliseconds / 1000) * fps)
}

function isPathWithin(parent: string, candidate: string): boolean {
	const relative = path.relative(parent, candidate)
	return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function resolvePublicAudioPath(segmentId: string, audioPublicPath: string): Promise<string> {
	const candidatePath = path.resolve(publicDirectory, audioPublicPath)
	const resolvedPublicDirectory = await realpath(publicDirectory)

	let resolvedAudioPath: string
	try {
		resolvedAudioPath = await realpath(candidatePath)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		throw new Error(
			`Segment ${segmentId} audio ${audioPublicPath} could not be resolved beneath public/: ${message}`
		)
	}

	if (!isPathWithin(resolvedPublicDirectory, resolvedAudioPath)) {
		throw new Error(`Segment ${segmentId} audio ${audioPublicPath} resolves outside public/`)
	}

	return resolvedAudioPath
}

function stateImagePublicPath(page: number, click: number): string {
	const paddedPage = String(page).padStart(3, '0')
	const paddedClick = String(click).padStart(3, '0')
	return `narration/generated/states/s${paddedPage}-c${paddedClick}.png`
}

export async function compileTimeline(
	manifest: NarrationManifest,
	probeDuration: (absolutePath: string) => Promise<number>
): Promise<CompiledTimeline> {
	const entries: CompiledTimelineEntry[] = []
	let startFrame = 0

	for (const slide of [...manifest.slides].sort((left, right) => left.page - right.page)) {
		for (const segment of [...slide.segments].sort((left, right) => left.click - right.click)) {
			const transitionMs = segment.transitionMs ?? manifest.defaults.transitionMs
			const leadInMs = segment.leadInMs ?? manifest.defaults.leadInMs
			const tailMs = segment.tailMs ?? manifest.defaults.tailMs
			let audioDurationMs = 0
			let silentMs = segment.silentMs ?? 0

			if (segment.audio) {
				const absolutePath = await resolvePublicAudioPath(segment.id, segment.audio)
				audioDurationMs = await probeDuration(absolutePath)
				if (!Number.isFinite(audioDurationMs) || audioDurationMs <= 0) {
					throw new Error(`Segment ${segment.id} audio ${segment.audio} has an invalid duration`)
				}
				silentMs = 0
			}

			const transitionFrames = millisecondsToFrames(transitionMs, FPS)
			const leadInFrames = millisecondsToFrames(leadInMs, FPS)
			const audioFrames = millisecondsToFrames(audioDurationMs || silentMs, FPS)
			const tailFrames = millisecondsToFrames(tailMs, FPS)
			const durationInFrames = transitionFrames + leadInFrames + audioFrames + tailFrames

			entries.push({
				id: segment.id,
				index: entries.length,
				page: slide.page,
				click: segment.click,
				text: segment.text,
				audioPublicPath: segment.audio ?? null,
				audioDurationMs,
				silentMs,
				transitionMs,
				leadInMs,
				tailMs,
				transitionFrames,
				leadInFrames,
				audioFrames,
				tailFrames,
				startFrame,
				durationInFrames,
				stateImagePublicPath: stateImagePublicPath(slide.page, segment.click)
			})

			startFrame += durationInFrames
		}
	}

	return {
		version: 1,
		fps: FPS,
		width: 1920,
		height: 1080,
		durationInFrames: startFrame,
		entries
	}
}

async function main(): Promise<void> {
	const source = await readFile(narrationSourcePath, 'utf8')
	const manifest = validateManifest(parse(source))
	const timeline = await compileTimeline(manifest, probeAudioDurationMs)

	if (process.argv.includes('--validate-only')) {
		console.log(`Validated narration timeline with ${timeline.entries.length} entries`)
		return
	}

	await mkdir(generatedDirectory, { recursive: true })
	await writeFile(generatedTimelinePath, `${JSON.stringify(timeline, null, 2)}\n`)
	console.log(`Wrote ${path.relative(process.cwd(), generatedTimelinePath)}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(error => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	})
}
