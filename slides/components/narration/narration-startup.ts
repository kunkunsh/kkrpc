import type { NarrationPlaybackEntry, NarrationPosition } from './narration-player'

export interface NarrationStartupOptions {
	entries: NarrationPlaybackEntry[]
	getCurrentPosition: () => NarrationPosition
	unlockAudio: (publicPath: string) => Promise<void>
	startPlayer: () => void
	stopAudio: () => void
	stopPlayer: () => void
}

export interface NarrationStartup {
	start: () => Promise<void>
	stop: () => void
	dispose: () => void
}

function positionsMatch(left: NarrationPosition, right: NarrationPosition): boolean {
	return left.page === right.page && left.click === right.click
}

export function createNarrationStartup(options: NarrationStartupOptions): NarrationStartup {
	let generation = 0
	let disposed = false

	function start(): Promise<void> {
		if (disposed) {
			return Promise.resolve()
		}

		generation += 1
		const startGeneration = generation
		const position = options.getCurrentPosition()
		const startIndex = options.entries.findIndex(entry => positionsMatch(entry, position))
		const audioPath = startIndex < 0
			? null
			: options.entries.slice(startIndex).find(entry => entry.audioPublicPath)?.audioPublicPath

		let unlocked: Promise<void>
		try {
			unlocked = audioPath ? options.unlockAudio(audioPath) : Promise.resolve()
		} catch (error) {
			return Promise.reject(error)
		}

		return unlocked.then(
			() => {
				if (!disposed && generation === startGeneration) {
					options.startPlayer()
				}
			},
			error => {
				if (!disposed && generation === startGeneration) {
					throw error
				}
			}
		)
	}

	function stop(): void {
		generation += 1
		options.stopAudio()
		options.stopPlayer()
	}

	function dispose(): void {
		if (disposed) {
			return
		}
		disposed = true
		stop()
	}

	return { start, stop, dispose }
}
