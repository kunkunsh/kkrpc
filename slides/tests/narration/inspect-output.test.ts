import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
	inspectProbeOutput,
	probeMedia,
	type FfprobeOutput
} from '../../scripts/narration/inspect-output'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	)
})

function validProbeOutput(overrides: Partial<FfprobeOutput> = {}): FfprobeOutput {
	return {
		streams: [
			{
				index: 0,
				codec_type: 'video',
				codec_name: 'h264',
				width: 1920,
				height: 1080,
				r_frame_rate: '30/1'
			},
			{
				index: 1,
				codec_type: 'audio',
				codec_name: 'aac'
			}
		],
		format: {
			duration: '10.000000'
		},
		...overrides
	}
}

describe('inspectProbeOutput', () => {
	it('reports exact expected media metadata as a machine-readable pass', () => {
		const report = inspectProbeOutput(
			validProbeOutput(),
			{ durationInFrames: 300, fps: 30 },
			'dist/narrated-slides.mp4'
		)

		expect(report).toEqual({
			status: 'pass',
			summary:
				'MP4 inspection passed: H.264/AAC, 1920x1080, 30 fps, 10.000s (0.000 ms from timeline)',
			output: 'dist/narrated-slides.mp4',
			errors: [],
			metadata: {
				videoStreamCount: 1,
				audioStreamCount: 1,
				video: {
					index: 0,
					codec: 'h264',
					width: 1920,
					height: 1080,
					frameRate: 30,
					rawFrameRate: '30/1'
				},
				audio: {
					index: 1,
					codec: 'aac'
				},
				expectedDurationSeconds: 10,
				actualDurationSeconds: 10,
				durationDifferenceMs: 0,
				durationToleranceMs: 100
			}
		})
	})

	it.each([
		{
			name: 'missing video',
			probe: validProbeOutput({ streams: [validProbeOutput().streams![1]] }),
			error: 'Expected exactly 1 video stream, found 0'
		},
		{
			name: 'missing audio',
			probe: validProbeOutput({ streams: [validProbeOutput().streams![0]] }),
			error: 'Expected exactly 1 audio stream, found 0'
		},
		{
			name: 'wrong video codec',
			probe: validProbeOutput({
				streams: [
					{ ...validProbeOutput().streams![0], codec_name: 'vp9' },
					validProbeOutput().streams![1]
				]
			}),
			error: 'Video stream 0 codec must be h264, found vp9'
		},
		{
			name: 'missing video stream index',
			probe: validProbeOutput({
				streams: [
					{ ...validProbeOutput().streams![0], index: undefined },
					validProbeOutput().streams![1]
				]
			}),
			error: 'Video stream index must be a non-negative integer, found missing'
		},
		{
			name: 'wrong audio codec',
			probe: validProbeOutput({
				streams: [
					validProbeOutput().streams![0],
					{ ...validProbeOutput().streams![1], codec_name: 'mp3' }
				]
			}),
			error: 'Audio stream 1 codec must be aac, found mp3'
		},
		{
			name: 'missing audio stream index',
			probe: validProbeOutput({
				streams: [
					validProbeOutput().streams![0],
					{ ...validProbeOutput().streams![1], index: undefined }
				]
			}),
			error: 'Audio stream index must be a non-negative integer, found missing'
		},
		{
			name: 'wrong dimensions',
			probe: validProbeOutput({
				streams: [
					{ ...validProbeOutput().streams![0], width: 1280, height: 720 },
					validProbeOutput().streams![1]
				]
			}),
			error: 'Video stream 0 dimensions must be 1920x1080, found 1280x720'
		},
		{
			name: 'fractional frame rate',
			probe: validProbeOutput({
				streams: [
					{ ...validProbeOutput().streams![0], r_frame_rate: '30000/1001' },
					validProbeOutput().streams![1]
				]
			}),
			error: 'Video stream 0 frame rate must be 30 fps, found 30000/1001 (29.970030 fps)'
		},
		{
			name: 'duration beyond tolerance',
			probe: validProbeOutput({ format: { duration: '10.101000' } }),
			error:
				'MP4 duration must be within 100 ms of the compiled timeline (expected 10.000000s, found 10.101000s, difference 101.000ms)'
		}
	])('fails closed for $name', ({ probe, error }) => {
		const report = inspectProbeOutput(
			probe,
			{ durationInFrames: 300, fps: 30 },
			'dist/narrated-slides.mp4'
		)

		expect(report.status).toBe('fail')
		expect(report.errors).toContain(error)
	})

	it('accepts a duration difference of exactly 100 ms', () => {
		const report = inspectProbeOutput(
			validProbeOutput({ format: { duration: '10.100000' } }),
			{ durationInFrames: 300, fps: 30 },
			'dist/narrated-slides.mp4'
		)

		expect(report.status).toBe('pass')
		expect(report.metadata.durationDifferenceMs).toBeCloseTo(100, 9)
	})

	it('rejects malformed probe and timeline values instead of applying defaults', () => {
		const report = inspectProbeOutput(
			{ streams: 'not-an-array', format: { duration: 'not-a-duration' } },
			{ durationInFrames: 0, fps: Number.NaN },
			'dist/narrated-slides.mp4'
		)

		expect(report.status).toBe('fail')
		expect(report.errors).toEqual(
			expect.arrayContaining([
				'ffprobe streams must be an array',
				'Compiled timeline fps must be a finite positive number',
				'Compiled timeline durationInFrames must be a positive integer',
				'ffprobe format.duration must be a finite positive number'
			])
		)
	})
})

describe('probeMedia', () => {
	it('passes a path containing shell metacharacters to real ffprobe without interpretation', async () => {
		const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'kkrpc-media-probe-'))
		temporaryDirectories.push(temporaryDirectory)
		const fixturePath = path.join(process.cwd(), 'narration/fixtures/tone-500ms.wav')
		const mediaPath = path.join(temporaryDirectory, 'tone;not-a-command.wav')
		await copyFile(fixturePath, mediaPath)

		const probe = await probeMedia(mediaPath)

		expect(probe.streams).toEqual([
			expect.objectContaining({
				index: 0,
				codec_type: 'audio',
				codec_name: 'pcm_s16le'
			})
		])
		expect(probe.format?.duration).toBe('0.500000')
	})
})
