import { describe, expect, it, vi } from 'vitest'
import { createNarrationStartup } from '../../components/narration/narration-startup'
import type { NarrationPlaybackEntry } from '../../components/narration/narration-player'

function entry(
	id: string,
	click: number,
	audioPublicPath: string | null
): NarrationPlaybackEntry {
	return {
		id,
		page: 1,
		click,
		audioPublicPath,
		silentMs: audioPublicPath ? 0 : 500,
		transitionMs: 0,
		leadInMs: 0,
		tailMs: 0
	}
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void
	const promise = new Promise<void>(resolvePromise => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

describe('createNarrationStartup', () => {
	it('unlocks the first future audio synchronously when the current entry is silent', async () => {
		const unlockAudio = vi.fn(async () => undefined)
		const startPlayer = vi.fn()
		const startup = createNarrationStartup({
			entries: [entry('silent', 0, null), entry('spoken', 1, 'spoken.mp3')],
			getCurrentPosition: () => ({ page: 1, click: 0 }),
			unlockAudio,
			startPlayer,
			stopAudio: vi.fn(),
			stopPlayer: vi.fn()
		})

		const started = startup.start()

		expect(unlockAudio).toHaveBeenCalledWith('spoken.mp3')
		await started
		expect(startPlayer).toHaveBeenCalledTimes(1)
	})

	it('does not start after Stop cancels a pending audio unlock', async () => {
		const unlock = deferred()
		const startPlayer = vi.fn()
		const stopAudio = vi.fn()
		const stopPlayer = vi.fn()
		const startup = createNarrationStartup({
			entries: [entry('spoken', 0, 'spoken.mp3')],
			getCurrentPosition: () => ({ page: 1, click: 0 }),
			unlockAudio: () => unlock.promise,
			startPlayer,
			stopAudio,
			stopPlayer
		})

		const started = startup.start()
		startup.stop()
		unlock.resolve()
		await started

		expect(stopAudio).toHaveBeenCalledTimes(1)
		expect(stopPlayer).toHaveBeenCalledTimes(1)
		expect(startPlayer).not.toHaveBeenCalled()
	})

	it('does not start after disposal cancels a pending audio unlock', async () => {
		const unlock = deferred()
		const startPlayer = vi.fn()
		const stopAudio = vi.fn()
		const stopPlayer = vi.fn()
		const startup = createNarrationStartup({
			entries: [entry('spoken', 0, 'spoken.mp3')],
			getCurrentPosition: () => ({ page: 1, click: 0 }),
			unlockAudio: () => unlock.promise,
			startPlayer,
			stopAudio,
			stopPlayer
		})

		const started = startup.start()
		startup.dispose()
		unlock.resolve()
		await started

		expect(stopAudio).toHaveBeenCalledTimes(1)
		expect(stopPlayer).toHaveBeenCalledTimes(1)
		expect(startPlayer).not.toHaveBeenCalled()
	})
})
