import { describe, expect, it, vi } from 'vitest'
import {
	createNarrationPlayer,
	type NarrationPlaybackEntry,
	type NarrationPosition
} from '../../components/narration/narration-player'

function entry(
	id: string,
	page: number,
	click: number,
	overrides: Partial<NarrationPlaybackEntry> = {}
): NarrationPlaybackEntry {
	return {
		id,
		page,
		click,
		audioPublicPath: `${id}.mp3`,
		silentMs: 0,
		transitionMs: 0,
		leadInMs: 0,
		tailMs: 0,
		...overrides
	}
}

function deferred(): {
	promise: Promise<void>
	resolve: () => void
	reject: (error: Error) => void
} {
	let resolve!: () => void
	let reject!: (error: Error) => void
	const promise = new Promise<void>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

async function flushPromises(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
}

describe('createNarrationPlayer', () => {
	it('runs each segment in timing, audio, tail, navigation order', async () => {
		const events: string[] = []
		let visible: NarrationPosition = { page: 1, click: 0 }
		const entries = [
			entry('a', 1, 0, { transitionMs: 30, leadInMs: 20, tailMs: 10 }),
			entry('b', 1, 1, { transitionMs: 40, leadInMs: 25, tailMs: 15 })
		]
		const player = createNarrationPlayer({
			entries,
			getCurrentPosition: () => visible,
			advance: () => {
				events.push('advance')
				visible = { page: 1, click: visible.click + 1 }
			},
			playAudio: async path => {
				events.push(`audio:${path}`)
			},
			wait: async milliseconds => {
				events.push(`wait:${milliseconds}`)
			}
		})

		await player.start()

		expect(events).toEqual([
			'wait:30',
			'wait:20',
			'audio:a.mp3',
			'wait:10',
			'advance',
			'wait:40',
			'wait:25',
			'audio:b.mp3',
			'wait:15',
			'advance'
		])
		expect(player.getSnapshot()).toEqual({
			status: 'completed',
			currentSegmentId: null,
			error: null
		})
	})

	it('stopping an active segment prevents later navigation', async () => {
		const audio = deferred()
		const advance = vi.fn()
		const stopAudio = vi.fn()
		const player = createNarrationPlayer({
			entries: [entry('a', 1, 0)],
			getCurrentPosition: () => ({ page: 1, click: 0 }),
			advance,
			playAudio: () => audio.promise,
			stopAudio,
			wait: async () => undefined
		})

		const run = player.start()
		await flushPromises()
		player.stop()
		audio.resolve()
		await run

		expect(stopAudio).toHaveBeenCalledTimes(1)
		expect(advance).not.toHaveBeenCalled()
		expect(player.getSnapshot().status).toBe('stopped')
	})

	it('changes to error without navigating when audio playback rejects', async () => {
		const advance = vi.fn()
		const player = createNarrationPlayer({
			entries: [entry('a', 1, 0)],
			getCurrentPosition: () => ({ page: 1, click: 0 }),
			advance,
			playAudio: async () => {
				throw new Error('decoder failed')
			},
			wait: async () => undefined
		})

		await player.start()

		expect(advance).not.toHaveBeenCalled()
		expect(player.getSnapshot()).toEqual({
			status: 'error',
			currentSegmentId: 'a',
			error: 'decoder failed'
		})
	})

	it('uses silentMs instead of audio for a silent segment', async () => {
		const wait = vi.fn(async () => undefined)
		const playAudio = vi.fn(async () => undefined)
		const player = createNarrationPlayer({
			entries: [
				entry('silent', 1, 0, {
					audioPublicPath: null,
					silentMs: 750,
					transitionMs: 30,
					leadInMs: 20,
					tailMs: 10
				})
			],
			getCurrentPosition: () => ({ page: 1, click: 0 }),
			advance: async () => undefined,
			playAudio,
			wait
		})

		await player.start()

		expect(wait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([30, 20, 750, 10])
		expect(playAudio).not.toHaveBeenCalled()
	})

	it('does not navigate while paused and resumes the active sequence', async () => {
		const audio = deferred()
		const advance = vi.fn()
		const pauseAudio = vi.fn()
		const resumeAudio = vi.fn(async () => undefined)
		const player = createNarrationPlayer({
			entries: [entry('a', 1, 0)],
			getCurrentPosition: () => ({ page: 1, click: 0 }),
			advance,
			playAudio: () => audio.promise,
			pauseAudio,
			resumeAudio,
			wait: async () => undefined
		})

		const run = player.start()
		await flushPromises()
		player.pause()
		audio.resolve()
		await flushPromises()

		expect(pauseAudio).toHaveBeenCalledTimes(1)
		expect(advance).not.toHaveBeenCalled()
		expect(player.getSnapshot().status).toBe('paused')

		await player.resume()
		await run

		expect(resumeAudio).toHaveBeenCalledTimes(1)
		expect(advance).toHaveBeenCalledTimes(1)
		expect(player.getSnapshot().status).toBe('completed')
	})

	it('keeps a pause requested during navigation across the next segment boundary', async () => {
		const advancePending = deferred()
		const advanceStarted = deferred()
		let visible: NarrationPosition = { page: 1, click: 0 }
		const playAudio = vi.fn(async () => undefined)
		const player = createNarrationPlayer({
			entries: [entry('a', 1, 0), entry('b', 1, 1)],
			getCurrentPosition: () => visible,
			advance: async () => {
				advanceStarted.resolve()
				await advancePending.promise
				visible = { page: 1, click: 1 }
			},
			playAudio,
			wait: async () => undefined
		})

		const run = player.start()
		await advanceStarted.promise
		player.pause()
		advancePending.resolve()
		await flushPromises()

		expect(player.getSnapshot().status).toBe('paused')
		expect(playAudio).toHaveBeenCalledTimes(1)

		await player.resume()
		await run

		expect(playAudio).toHaveBeenCalledTimes(2)
		expect(player.getSnapshot().status).toBe('completed')
	})

	it('restarting begins at the currently visible page and click', async () => {
		let visible: NarrationPosition = { page: 2, click: 1 }
		const played: string[] = []
		const player = createNarrationPlayer({
			entries: [entry('a', 1, 0), entry('b', 2, 1), entry('c', 2, 2)],
			getCurrentPosition: () => visible,
			advance: () => {
				visible = { page: 2, click: visible.click + 1 }
			},
			playAudio: async path => {
				played.push(path)
			},
			wait: async () => undefined
		})

		await player.start()

		expect(played).toEqual(['b.mp3', 'c.mp3'])
	})

	it('stops with an error when Slidev does not reach the next timeline state', async () => {
		const playAudio = vi.fn(async () => undefined)
		const player = createNarrationPlayer({
			entries: [entry('a', 1, 0), entry('b', 1, 1)],
			getCurrentPosition: () => ({ page: 1, click: 0 }),
			advance: async () => undefined,
			playAudio,
			wait: async () => undefined
		})

		await player.start()

		expect(playAudio).toHaveBeenCalledTimes(1)
		expect(player.getSnapshot()).toEqual({
			status: 'error',
			currentSegmentId: 'a',
			error: 'Expected Slidev state 1/1 after a, received 1/0'
		})
	})

	it('ignores completion from a superseded run', async () => {
		const firstAudio = deferred()
		const firstAudioStarted = deferred()
		let visible: NarrationPosition = { page: 1, click: 0 }
		let playCount = 0
		const advance = vi.fn(() => {
			visible = { page: 1, click: visible.click + 1 }
		})
		const player = createNarrationPlayer({
			entries: [entry('a', 1, 0)],
			getCurrentPosition: () => visible,
			advance,
			playAudio: () => {
				playCount += 1
				if (playCount === 1) {
					firstAudioStarted.resolve()
					return firstAudio.promise
				}
				return Promise.resolve()
			},
			wait: async () => undefined
		})

		const supersededRun = player.start()
		await firstAudioStarted.promise
		const activeRun = player.start()
		await activeRun
		firstAudio.resolve()
		await supersededRun

		expect(advance).toHaveBeenCalledTimes(1)
		expect(player.getSnapshot().status).toBe('completed')
	})
})
