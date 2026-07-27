export interface NarrationPosition {
	page: number
	click: number
}

export interface NarrationPlaybackEntry extends NarrationPosition {
	id: string
	audioPublicPath: string | null
	silentMs: number
	transitionMs: number
	leadInMs: number
	tailMs: number
}

export type NarrationPlayerStatus =
	| 'idle'
	| 'playing'
	| 'paused'
	| 'stopped'
	| 'completed'
	| 'error'

export interface NarrationPlayerSnapshot {
	status: NarrationPlayerStatus
	currentSegmentId: string | null
	error: string | null
}

export interface NarrationPlayerOptions {
	entries: NarrationPlaybackEntry[]
	getCurrentPosition: () => NarrationPosition
	advance: () => void | Promise<void>
	playAudio: (publicPath: string) => Promise<void>
	wait: (milliseconds: number, signal: AbortSignal) => Promise<void>
	now?: () => number
	pauseAudio?: () => void
	resumeAudio?: () => void | Promise<void>
	stopAudio?: () => void
	onStateChange?: (snapshot: NarrationPlayerSnapshot) => void
}

export interface NarrationPlayer {
	start: () => Promise<void>
	pause: () => void
	resume: () => Promise<void>
	stop: () => void
	getSnapshot: () => NarrationPlayerSnapshot
}

function positionsMatch(left: NarrationPosition, right: NarrationPosition): boolean {
	return left.page === right.page && left.click === right.click
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

export function createNarrationPlayer(options: NarrationPlayerOptions): NarrationPlayer {
	let generation = 0
	let snapshot: NarrationPlayerSnapshot = {
		status: 'idle',
		currentSegmentId: null,
		error: null
	}
	let pausedResolvers = new Set<(active: boolean) => void>()
	let activeWaitAbort: AbortController | null = null
	const now = options.now ?? (() => Date.now())

	function publish(next: NarrationPlayerSnapshot): void {
		snapshot = next
		options.onStateChange?.({ ...snapshot })
	}

	function releasePaused(active: boolean): void {
		const resolvers = pausedResolvers
		pausedResolvers = new Set()
		for (const resolve of resolvers) {
			resolve(active)
		}
	}

	function isActive(runGeneration: number): boolean {
		return generation === runGeneration && snapshot.status !== 'stopped' && snapshot.status !== 'error'
	}

	function abortActiveWait(): void {
		activeWaitAbort?.abort()
		activeWaitAbort = null
	}

	async function waitUntilPlaying(runGeneration: number): Promise<boolean> {
		if (!isActive(runGeneration)) {
			return false
		}
		if (snapshot.status !== 'paused') {
			return true
		}
		return new Promise(resolve => {
			pausedResolvers.add(resolve)
		})
	}

	async function runWait(milliseconds: number, runGeneration: number): Promise<boolean> {
		let remaining = milliseconds

		while (remaining > 0) {
			if (!(await waitUntilPlaying(runGeneration))) {
				return false
			}

			const startedAt = now()
			const waitAbort = new AbortController()
			activeWaitAbort = waitAbort
			await options.wait(remaining, waitAbort.signal)
			if (activeWaitAbort === waitAbort) {
				activeWaitAbort = null
			}

			if (!isActive(runGeneration)) {
				return false
			}
			if (!waitAbort.signal.aborted) {
				return waitUntilPlaying(runGeneration)
			}

			const elapsed = Math.max(0, now() - startedAt)
			remaining = Math.max(0, remaining - elapsed)
		}

		return waitUntilPlaying(runGeneration)
	}

	async function runEntry(
		entry: NarrationPlaybackEntry,
		nextEntry: NarrationPlaybackEntry | undefined,
		runGeneration: number
	): Promise<boolean> {
		if (!isActive(runGeneration)) {
			return false
		}
		publish({
			status: snapshot.status === 'paused' ? 'paused' : 'playing',
			currentSegmentId: entry.id,
			error: null
		})

		if (!(await runWait(entry.transitionMs, runGeneration))) {
			return false
		}
		if (!(await runWait(entry.leadInMs, runGeneration))) {
			return false
		}

		if (entry.audioPublicPath) {
			await options.playAudio(entry.audioPublicPath)
			if (!(await waitUntilPlaying(runGeneration))) {
				return false
			}
		} else if (!(await runWait(entry.silentMs, runGeneration))) {
			return false
		}

		if (!(await runWait(entry.tailMs, runGeneration))) {
			return false
		}
		if (!isActive(runGeneration)) {
			return false
		}

		await options.advance()
		if (!isActive(runGeneration)) {
			return false
		}

		const visible = options.getCurrentPosition()
		if (nextEntry) {
			if (!positionsMatch(visible, nextEntry)) {
				throw new Error(
					`Expected Slidev state ${nextEntry.page}/${nextEntry.click} after ${entry.id}, ` +
						`received ${visible.page}/${visible.click}`
				)
			}
		} else if (positionsMatch(visible, entry)) {
			throw new Error(
				`Expected Slidev to leave terminal state ${entry.page}/${entry.click} after ${entry.id}, ` +
					`received ${visible.page}/${visible.click}`
			)
		}

		return true
	}

	async function runFrom(startIndex: number, runGeneration: number): Promise<void> {
		try {
			for (let index = startIndex; index < options.entries.length; index += 1) {
				const continued = await runEntry(
					options.entries[index],
					options.entries[index + 1],
					runGeneration
				)
				if (!continued) {
					return
				}
			}

			if (generation === runGeneration) {
				publish({ status: 'completed', currentSegmentId: null, error: null })
			}
		} catch (error) {
			if (generation !== runGeneration) {
				return
			}
			options.stopAudio?.()
			publish({
				status: 'error',
				currentSegmentId: snapshot.currentSegmentId,
				error: errorMessage(error)
			})
		}
	}

	function start(): Promise<void> {
		generation += 1
		abortActiveWait()
		releasePaused(false)
		if (snapshot.status === 'playing' || snapshot.status === 'paused') {
			options.stopAudio?.()
		}

		const position = options.getCurrentPosition()
		const startIndex = options.entries.findIndex(entry => positionsMatch(entry, position))
		if (startIndex < 0) {
			publish({
				status: 'error',
				currentSegmentId: null,
				error: `No narration entry for Slidev state ${position.page}/${position.click}`
			})
			return Promise.resolve()
		}

		const runGeneration = generation
		publish({
			status: 'playing',
			currentSegmentId: options.entries[startIndex].id,
			error: null
		})
		return runFrom(startIndex, runGeneration)
	}

	function pause(): void {
		if (snapshot.status !== 'playing') {
			return
		}
		abortActiveWait()
		options.pauseAudio?.()
		publish({ ...snapshot, status: 'paused' })
	}

	async function resume(): Promise<void> {
		if (snapshot.status !== 'paused') {
			return
		}
		try {
			await options.resumeAudio?.()
			publish({ ...snapshot, status: 'playing' })
			releasePaused(true)
		} catch (error) {
			generation += 1
			abortActiveWait()
			releasePaused(false)
			options.stopAudio?.()
			publish({
				status: 'error',
				currentSegmentId: snapshot.currentSegmentId,
				error: errorMessage(error)
			})
		}
	}

	function stop(): void {
		if (snapshot.status === 'idle' || snapshot.status === 'stopped') {
			return
		}
		generation += 1
		abortActiveWait()
		releasePaused(false)
		options.stopAudio?.()
		publish({ status: 'stopped', currentSegmentId: snapshot.currentSegmentId, error: null })
	}

	return {
		start,
		pause,
		resume,
		stop,
		getSnapshot: () => ({ ...snapshot })
	}
}
