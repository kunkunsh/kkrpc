import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { compileTimeline, millisecondsToFrames } from '../../scripts/narration/build-timeline'
import { probeAudioDurationMs } from '../../scripts/narration/probe-audio'
import { generatedTimelinePath, narrationSourcePath, publicDirectory } from '../../scripts/narration/paths'
import { type NarrationManifest, validateManifest } from '../../scripts/narration/schema'
import { createSilentWav } from './create-silent-wav'

const testAudioDirectory = path.join(publicDirectory, 'narration/audio')
const testAudioPath = path.join(testAudioDirectory, 'a.wav')
const execFile = promisify(execFileCallback)

afterEach(async () => {
	await rm(testAudioPath, { force: true })
})

describe('validateManifest', () => {
	it('accepts sequential click segments beginning at click zero', () => {
		const result = validateManifest({
			version: 1,
			defaults: { transitionMs: 300, leadInMs: 100, tailMs: 150 },
			slides: [
				{
					page: 1,
					segments: [
						{ id: 'intro', click: 0, text: 'Intro', audio: 'narration/audio/s001-c000.mp3' },
						{ id: 'detail', click: 1, text: 'Detail', silentMs: 500 }
					]
				}
			]
		})

		expect(result.slides[0].segments.map(segment => segment.click)).toEqual([0, 1])
	})

	it('rejects a slide whose first segment is not click zero', () => {
		expect(() =>
			validateManifest({
				version: 1,
				defaults: { transitionMs: 300, leadInMs: 100, tailMs: 150 },
				slides: [
					{
						page: 1,
						segments: [{ id: 'bad', click: 1, text: 'Bad', silentMs: 500 }]
					}
				]
			})
		).toThrow(/click 0/)
	})

	it('rejects duplicate segment ids', () => {
		expect(() =>
			validateManifest({
				version: 1,
				defaults: { transitionMs: 300, leadInMs: 100, tailMs: 150 },
				slides: [
					{ page: 1, segments: [{ id: 'same', click: 0, text: '', silentMs: 500 }] },
					{ page: 2, segments: [{ id: 'same', click: 0, text: '', silentMs: 500 }] }
				]
			})
		).toThrow(/duplicate segment id/i)
	})

	it('accepts non-negative silent durations', () => {
		const result = validateManifest({
			version: 1,
			defaults: { transitionMs: 300, leadInMs: 100, tailMs: 150 },
			slides: [
				{
					page: 1,
					segments: [
						{ id: 'instant', click: 0, text: '', silentMs: 0 },
						{ id: 'long-pause', click: 1, text: '', silentMs: 60_001 }
					]
				}
			]
		})

		expect(result.slides[0].segments[0].silentMs).toBe(0)
		expect(result.slides[0].segments[1].silentMs).toBe(60_001)
	})

	it.each([
	'/narration/audio/absolute.mp3',
	'public/narration/audio/redundant-prefix.mp3',
	'../narration/audio/traversal.mp3',
	'https://example.com/narration.mp3'
])('rejects an audio path that is not safely relative to public: %s', audio => {
		expect(() =>
			validateManifest({
				version: 1,
				defaults: { transitionMs: 300, leadInMs: 100, tailMs: 150 },
				slides: [
					{
						page: 1,
						segments: [{ id: 'unsafe-audio', click: 0, text: '', audio }]
					}
				]
			})
		).toThrow(/safe path relative to public/i)
	})
})

describe('timeline compilation', () => {
	it('converts milliseconds to frames', () => {
		expect(millisecondsToFrames(500, 30)).toBe(15)
		expect(millisecondsToFrames(1000, 30)).toBe(30)
		expect(millisecondsToFrames(-500, 30)).toBe(0)
	})

	it('probes the deterministic fixture duration', async () => {
		await createSilentWav(testAudioPath)

		await expect(probeAudioDurationMs(testAudioPath)).resolves.toBeCloseTo(500, -1)
	})

	it('creates contiguous entries', async () => {
		await createSilentWav(testAudioPath)

		const manifest = validateManifest({
			version: 1,
			defaults: { transitionMs: 300, leadInMs: 100, tailMs: 150 },
			slides: [
				{
					page: 1,
					segments: [
						{ id: 'a', click: 0, text: 'A', audio: 'narration/audio/a.wav' },
						{ id: 'b', click: 1, text: 'B', silentMs: 1000 }
					]
				}
			]
		})

		const timeline = await compileTimeline(manifest, async () => 500)

		expect(timeline.entries[0].startFrame).toBe(0)
		expect(timeline.entries[1].startFrame).toBe(timeline.entries[0].durationInFrames)
		expect(timeline.durationInFrames).toBe(
			timeline.entries.reduce((sum, entry) => sum + entry.durationInFrames, 0)
		)
		expect(timeline.entries[0].stateImagePublicPath).toBe(
			'narration/generated/states/s001-c000.png'
		)
	})

	it('normalizes fractional probed durations before storing them', async () => {
		await createSilentWav(testAudioPath)

		const manifest = validateManifest({
			version: 1,
			defaults: { transitionMs: 0, leadInMs: 0, tailMs: 0 },
			slides: [
				{
					page: 1,
					segments: [{ id: 'fractional-audio', click: 0, text: '', audio: 'narration/audio/a.wav' }]
				}
			]
		})

		const timeline = await compileTimeline(manifest, async () => 500.6)

		expect(timeline.entries[0].audioDurationMs).toBe(501)
		expect(Number.isInteger(timeline.entries[0].audioDurationMs)).toBe(true)
	})

	it('rejects a lexically escaped candidate before resolving it', async () => {
		const manifest = {
			version: 1,
			defaults: { transitionMs: 0, leadInMs: 0, tailMs: 0 },
			slides: [
				{
					page: 1,
					segments: [
						{
							id: 'lexical-audio',
							click: 0,
							text: '',
							audio: '../narration/fixtures/not-an-audio-file.wav'
						}
					]
				}
			]
		} as NarrationManifest

		await expect(compileTimeline(manifest, async () => 500)).rejects.toThrow(
			/lexical-audio.*lexically outside public/i
		)
	})

	it('rejects an audio symlink that escapes public', async () => {
		const escapedAudioPath = path.join(testAudioDirectory, 'escaped.wav')
		const outsideDirectory = await mkdtemp(path.join(tmpdir(), 'kkrpc-narration-'))
		const outsideAudioPath = path.join(outsideDirectory, 'outside.wav')

		await mkdir(testAudioDirectory, { recursive: true })
		await createSilentWav(outsideAudioPath)
		await symlink(outsideAudioPath, escapedAudioPath)

		const manifest = validateManifest({
			version: 1,
			defaults: { transitionMs: 0, leadInMs: 0, tailMs: 0 },
			slides: [
				{
					page: 1,
					segments: [{ id: 'escaped-audio', click: 0, text: '', audio: 'narration/audio/escaped.wav' }]
				}
			]
		})

		try {
			await expect(compileTimeline(manifest, async () => 500)).rejects.toThrow(
				/escaped-audio.*narration\/audio\/escaped\.wav/i
			)
		} finally {
			await rm(escapedAudioPath, { force: true })
			await rm(outsideDirectory, { force: true, recursive: true })
		}
	})

	it('compiles the initial manifest against every committed fixture audio file', async () => {
		const manifest = validateManifest(parse(await readFile(narrationSourcePath, 'utf8')))
		const expectedEntryCount = manifest.slides.reduce(
			(total, slide) => total + slide.segments.length,
			0
		)

		const timeline = await compileTimeline(manifest, probeAudioDurationMs)

		expect(timeline.entries).toHaveLength(expectedEntryCount)
		expect(timeline.entries.every(entry => Number.isInteger(entry.audioDurationMs))).toBe(true)
	})

	it('does not write timeline JSON while validating', async () => {
		const timelineBeforeValidation = await readFile(generatedTimelinePath, 'utf8')

		await execFile('pnpm', ['narration:validate'], { cwd: process.cwd() })

		expect(await readFile(generatedTimelinePath, 'utf8')).toBe(timelineBeforeValidation)
	})
})
