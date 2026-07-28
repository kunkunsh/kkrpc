import { execFile as execFileCallback } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { generatedTimelinePath } from './paths'

const execFile = promisify(execFileCallback)
const EXPECTED_VIDEO_CODEC = 'h264'
const EXPECTED_AUDIO_CODEC = 'aac'
const EXPECTED_WIDTH = 1920
const EXPECTED_HEIGHT = 1080
const EXPECTED_FPS = 30
const DURATION_TOLERANCE_MS = 100

export interface FfprobeStream {
	index?: number
	codec_type?: string
	codec_name?: string
	width?: number
	height?: number
	r_frame_rate?: string
	[key: string]: unknown
}

export interface FfprobeOutput {
	streams?: FfprobeStream[]
	format?: {
		duration?: string
		[key: string]: unknown
	}
	[key: string]: unknown
}

export interface TimelineDuration {
	durationInFrames: unknown
	fps: unknown
}

interface VideoMetadata {
	index: number
	codec: string
	width: number
	height: number
	frameRate: number
	rawFrameRate: string
}

interface AudioMetadata {
	index: number
	codec: string
}

interface InspectionMetadata {
	videoStreamCount: number
	audioStreamCount: number
	video?: VideoMetadata
	audio?: AudioMetadata
	expectedDurationSeconds: number | null
	actualDurationSeconds: number | null
	durationDifferenceMs: number | null
	durationToleranceMs: number
}

export interface InspectionReport {
	status: 'pass' | 'fail'
	summary: string
	output: string
	errors: string[]
	metadata: InspectionMetadata
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function describeValue(value: unknown): string {
	if (value === undefined) return 'missing'
	if (typeof value === 'string') return value
	return JSON.stringify(value)
}

function parseFrameRate(value: unknown): number | null {
	if (typeof value !== 'string') return null
	const match = /^([0-9]+)\/([0-9]+)$/.exec(value)
	if (!match) return null

	const numerator = Number(match[1])
	const denominator = Number(match[2])
	if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
		return null
	}

	const frameRate = numerator / denominator
	return Number.isFinite(frameRate) && frameRate > 0 ? frameRate : null
}

function validStreamIndex(stream: FfprobeStream): number | null {
	return Number.isInteger(stream.index) && Number(stream.index) >= 0 ? Number(stream.index) : null
}

function failedReport(
	output: string,
	errors: string[],
	metadata: InspectionMetadata = {
		videoStreamCount: 0,
		audioStreamCount: 0,
		expectedDurationSeconds: null,
		actualDurationSeconds: null,
		durationDifferenceMs: null,
		durationToleranceMs: DURATION_TOLERANCE_MS
	}
): InspectionReport {
	return {
		status: 'fail',
		summary: `MP4 inspection failed with ${errors.length} error${errors.length === 1 ? '' : 's'}`,
		output,
		errors,
		metadata
	}
}

export function inspectProbeOutput(
	probeOutput: unknown,
	timeline: TimelineDuration,
	output: string
): InspectionReport {
	const errors: string[] = []
	const root =
		typeof probeOutput === 'object' && probeOutput !== null
			? (probeOutput as Record<string, unknown>)
			: null
	const rawStreams = root?.streams
	const streams = Array.isArray(rawStreams)
		? rawStreams.filter(
				(stream): stream is FfprobeStream => typeof stream === 'object' && stream !== null
			)
		: []

	if (!Array.isArray(rawStreams)) errors.push('ffprobe streams must be an array')
	if (Array.isArray(rawStreams) && streams.length !== rawStreams.length) {
		errors.push('Every ffprobe stream entry must be an object')
	}

	const videoStreams = streams.filter((stream) => stream.codec_type === 'video')
	const audioStreams = streams.filter((stream) => stream.codec_type === 'audio')
	if (videoStreams.length !== 1) {
		errors.push(`Expected exactly 1 video stream, found ${videoStreams.length}`)
	}
	if (audioStreams.length !== 1) {
		errors.push(`Expected exactly 1 audio stream, found ${audioStreams.length}`)
	}

	let video: VideoMetadata | undefined
	const videoStream = videoStreams[0]
	if (videoStream) {
		const position = streams.indexOf(videoStream)
		const index = validStreamIndex(videoStream)
		const streamLabel = index === null ? `at position ${position}` : String(index)
		const codec = videoStream.codec_name
		const width = videoStream.width
		const height = videoStream.height
		const rawFrameRate = videoStream.r_frame_rate
		const frameRate = parseFrameRate(rawFrameRate)

		if (index === null) {
			errors.push(
				`Video stream index must be a non-negative integer, found ${describeValue(videoStream.index)}`
			)
		}
		if (codec !== EXPECTED_VIDEO_CODEC) {
			errors.push(
				`Video stream ${streamLabel} codec must be ${EXPECTED_VIDEO_CODEC}, found ${describeValue(codec)}`
			)
		}
		if (width !== EXPECTED_WIDTH || height !== EXPECTED_HEIGHT) {
			errors.push(
				`Video stream ${streamLabel} dimensions must be ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}, ` +
					`found ${describeValue(width)}x${describeValue(height)}`
			)
		}
		if (frameRate !== EXPECTED_FPS) {
			const parsedRate = frameRate === null ? 'invalid' : `${frameRate.toFixed(6)} fps`
			errors.push(
				`Video stream ${streamLabel} frame rate must be ${EXPECTED_FPS} fps, ` +
					`found ${describeValue(rawFrameRate)} (${parsedRate})`
			)
		}

		if (
			index !== null &&
			typeof codec === 'string' &&
			typeof width === 'number' &&
			typeof height === 'number' &&
			typeof rawFrameRate === 'string' &&
			frameRate !== null
		) {
			video = { index, codec, width, height, frameRate, rawFrameRate }
		}
	}

	let audio: AudioMetadata | undefined
	const audioStream = audioStreams[0]
	if (audioStream) {
		const position = streams.indexOf(audioStream)
		const index = validStreamIndex(audioStream)
		const streamLabel = index === null ? `at position ${position}` : String(index)
		const codec = audioStream.codec_name
		if (index === null) {
			errors.push(
				`Audio stream index must be a non-negative integer, found ${describeValue(audioStream.index)}`
			)
		}
		if (codec !== EXPECTED_AUDIO_CODEC) {
			errors.push(
				`Audio stream ${streamLabel} codec must be ${EXPECTED_AUDIO_CODEC}, found ${describeValue(codec)}`
			)
		}
		if (index !== null && typeof codec === 'string') audio = { index, codec }
	}

	const fps = timeline.fps
	const durationInFrames = timeline.durationInFrames
	if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) {
		errors.push('Compiled timeline fps must be a finite positive number')
	}
	if (!Number.isInteger(durationInFrames) || Number(durationInFrames) <= 0) {
		errors.push('Compiled timeline durationInFrames must be a positive integer')
	}

	const expectedDurationSeconds =
		typeof fps === 'number' &&
		Number.isFinite(fps) &&
		fps > 0 &&
		Number.isInteger(durationInFrames) &&
		Number(durationInFrames) > 0
			? Number(durationInFrames) / fps
			: null

	const rawFormat = root?.format
	const rawDuration =
		typeof rawFormat === 'object' && rawFormat !== null
			? (rawFormat as Record<string, unknown>).duration
			: undefined
	const actualDurationSeconds = Number(rawDuration)
	const hasValidActualDuration =
		(typeof rawDuration === 'string' || typeof rawDuration === 'number') &&
		Number.isFinite(actualDurationSeconds) &&
		actualDurationSeconds > 0
	if (!hasValidActualDuration) {
		errors.push('ffprobe format.duration must be a finite positive number')
	}

	const durationDifferenceMs =
		expectedDurationSeconds !== null && hasValidActualDuration
			? Math.abs(actualDurationSeconds - expectedDurationSeconds) * 1000
			: null
	if (
		durationDifferenceMs !== null &&
		durationDifferenceMs - DURATION_TOLERANCE_MS > Number.EPSILON
	) {
		errors.push(
			`MP4 duration must be within ${DURATION_TOLERANCE_MS} ms of the compiled timeline ` +
				`(expected ${expectedDurationSeconds!.toFixed(6)}s, ` +
				`found ${actualDurationSeconds.toFixed(6)}s, ` +
				`difference ${durationDifferenceMs.toFixed(3)}ms)`
		)
	}

	const metadata: InspectionMetadata = {
		videoStreamCount: videoStreams.length,
		audioStreamCount: audioStreams.length,
		...(video ? { video } : {}),
		...(audio ? { audio } : {}),
		expectedDurationSeconds,
		actualDurationSeconds: hasValidActualDuration ? actualDurationSeconds : null,
		durationDifferenceMs,
		durationToleranceMs: DURATION_TOLERANCE_MS
	}

	if (errors.length > 0) return failedReport(output, errors, metadata)

	return {
		status: 'pass',
		summary:
			`MP4 inspection passed: H.264/AAC, ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}, ` +
			`${EXPECTED_FPS} fps, ${actualDurationSeconds.toFixed(3)}s ` +
			`(${durationDifferenceMs!.toFixed(3)} ms from timeline)`,
		output,
		errors: [],
		metadata
	}
}

export async function probeMedia(outputPath: string): Promise<FfprobeOutput> {
	let stdout: string
	try {
		;({ stdout } = await execFile('ffprobe', [
			'-v',
			'error',
			'-show_entries',
			'format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate',
			'-of',
			'json',
			outputPath
		]))
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			throw new Error('ffprobe is unavailable; install FFmpeg and ensure ffprobe is on PATH')
		}

		const stderr =
			error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string'
				? error.stderr.trim()
				: ''
		throw new Error(
			`Unable to inspect MP4 ${outputPath} with ffprobe: ${stderr || errorMessage(error)}`
		)
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(stdout)
	} catch {
		throw new Error(`ffprobe returned invalid JSON for ${outputPath}`)
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`ffprobe returned a non-object JSON value for ${outputPath}`)
	}

	return parsed as FfprobeOutput
}

export async function inspectOutput(
	outputPath: string,
	timelinePath = generatedTimelinePath
): Promise<InspectionReport> {
	let timeline: unknown
	try {
		timeline = JSON.parse(await readFile(timelinePath, 'utf8'))
	} catch (error) {
		return failedReport(outputPath, [
			`Unable to read compiled timeline ${timelinePath}: ${errorMessage(error)}`
		])
	}
	if (typeof timeline !== 'object' || timeline === null || Array.isArray(timeline)) {
		return failedReport(outputPath, [
			`Compiled timeline ${timelinePath} must contain a JSON object`
		])
	}

	try {
		return inspectProbeOutput(
			await probeMedia(outputPath),
			timeline as TimelineDuration,
			outputPath
		)
	} catch (error) {
		return failedReport(outputPath, [errorMessage(error)])
	}
}

async function main(): Promise<void> {
	const arguments_ = process.argv.slice(2)
	if (arguments_.length !== 1) {
		const report = failedReport('', [
			'Usage: tsx scripts/narration/inspect-output.ts <rendered-mp4>'
		])
		console.log(JSON.stringify(report, null, 2))
		process.exitCode = 1
		return
	}

	const outputPath = path.resolve(arguments_[0])
	const displayPath = path.relative(process.cwd(), outputPath) || path.basename(outputPath)
	const report = await inspectOutput(outputPath)
	console.log(JSON.stringify({ ...report, output: displayPath }, null, 2))
	if (report.status === 'fail') process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		const report = failedReport('', [errorMessage(error)])
		console.log(JSON.stringify(report, null, 2))
		process.exitCode = 1
	})
}
