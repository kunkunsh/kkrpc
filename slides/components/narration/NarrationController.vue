<script setup lang="ts">
import { useNav } from '@slidev/client'
import { computed, onUnmounted, ref } from 'vue'
import timelineData from '../../narration/generated/timeline.json'
import type { CompiledTimeline } from './types'
import {
	createNarrationPlayer,
	type NarrationPlayerSnapshot,
	type NarrationPosition
} from './narration-player'
import { createNarrationStartup } from './narration-startup'

interface AudioPlayback {
	unlock: (publicPath: string) => Promise<void>
	play: (publicPath: string) => Promise<void>
	pause: () => void
	resume: () => Promise<void>
	stop: () => void
}

interface PendingPlayback {
	resolve: () => void
	reject: (error: Error) => void
	cleanup: () => void
}

const timeline = timelineData as CompiledTimeline
const nav = useNav()
const state = ref<NarrationPlayerSnapshot>({
	status: 'idle',
	currentSegmentId: null,
	error: null
})
const unlockError = ref<string | null>(null)
const isUnlocking = ref(false)
const isCapture = typeof window !== 'undefined'
	&& new URLSearchParams(window.location.search).get('narrationCapture') === '1'

function audioUrl(publicPath: string): string {
	return new URL(publicPath, document.baseURI).href
}

function createAudioPlayback(): AudioPlayback {
	let audio: HTMLAudioElement | null = null
	let audioPath: string | null = null
	let pending: PendingPlayback | null = null

	function settlePending(error?: Error): void {
		if (!pending) {
			return
		}
		const current = pending
		pending = null
		current.cleanup()
		if (error) {
			current.reject(error)
		} else {
			current.resolve()
		}
	}

	function releaseAudio(): void {
		if (!audio) {
			return
		}
		audio.pause()
		audio.removeAttribute('src')
		audio.load()
		audio = null
		audioPath = null
	}

	function stop(): void {
		settlePending()
		releaseAudio()
	}

	function createAudio(publicPath: string): HTMLAudioElement {
		releaseAudio()
		const nextAudio = new Audio(audioUrl(publicPath))
		nextAudio.preload = 'auto'
		audio = nextAudio
		audioPath = publicPath
		return nextAudio
	}

	async function unlock(publicPath: string): Promise<void> {
		stop()
		const unlockedAudio = createAudio(publicPath)
		unlockedAudio.muted = true

		// This play() is intentionally invoked before the first await in the click handler.
		// Muting prevents any narration from leaking before its transition and lead-in.
		const unlocked = unlockedAudio.play()
		await unlocked
		if (audio !== unlockedAudio) {
			return
		}
		unlockedAudio.pause()
		unlockedAudio.currentTime = 0
		unlockedAudio.muted = false
	}

	function play(publicPath: string): Promise<void> {
		const playingAudio = audio && audioPath === publicPath ? audio : createAudio(publicPath)
		playingAudio.muted = false
		playingAudio.currentTime = 0

		return new Promise<void>((resolve, reject) => {
			const onEnded = () => {
				settlePending()
				releaseAudio()
			}
			const onError = () => {
				const message = playingAudio.error?.message || `Unable to play narration audio ${publicPath}`
				settlePending(new Error(message))
				releaseAudio()
			}
			const cleanup = () => {
				playingAudio.removeEventListener('ended', onEnded)
				playingAudio.removeEventListener('error', onError)
			}
			pending = { resolve, reject, cleanup }
			playingAudio.addEventListener('ended', onEnded, { once: true })
			playingAudio.addEventListener('error', onError, { once: true })
			playingAudio.play().catch(error => {
				settlePending(error instanceof Error ? error : new Error(String(error)))
				releaseAudio()
			})
		})
	}

	return {
		unlock,
		play,
		pause: () => {
			audio?.pause()
		},
		resume: async () => {
			if (audio && pending) {
				await audio.play()
			}
		},
		stop
	}
}

function currentPosition(): NarrationPosition {
	return {
		page: nav.currentPage.value,
		click: nav.clicks.value
	}
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise(resolve => {
		if (signal.aborted) {
			resolve()
			return
		}

		const timer = window.setTimeout(finish, milliseconds)
		function finish(): void {
			window.clearTimeout(timer)
			signal.removeEventListener('abort', finish)
			resolve()
		}
		signal.addEventListener('abort', finish, { once: true })
	})
}

const audioPlayback = createAudioPlayback()
const player = createNarrationPlayer({
	entries: timeline.entries,
	getCurrentPosition: currentPosition,
	advance: () => nav.next(),
	playAudio: publicPath => audioPlayback.play(publicPath),
	wait,
	pauseAudio: audioPlayback.pause,
	resumeAudio: audioPlayback.resume,
	stopAudio: audioPlayback.stop,
	onStateChange: nextState => {
		state.value = nextState
	}
})

const startup = createNarrationStartup({
	entries: timeline.entries,
	getCurrentPosition: currentPosition,
	unlockAudio: audioPlayback.unlock,
	startPlayer: () => {
		void player.start()
	},
	stopAudio: audioPlayback.stop,
	stopPlayer: player.stop
})
const canStart = computed(() =>
	!isUnlocking.value && state.value.status !== 'playing' && state.value.status !== 'paused'
)
const displayedError = computed(() => unlockError.value ?? state.value.error)

async function start(): Promise<void> {
	if (!canStart.value) {
		return
	}
	unlockError.value = null
	isUnlocking.value = true

	try {
		const started = startup.start()
		await started
	} catch (error) {
		unlockError.value = error instanceof Error ? error.message : String(error)
	} finally {
		isUnlocking.value = false
	}
}

function pause(): void {
	player.pause()
}

function resume(): void {
	void player.resume()
}

function stop(): void {
	startup.stop()
}

onUnmounted(() => {
	startup.dispose()
})
</script>

<template>
	<div
		v-if="!isCapture"
		class="narration-controller"
		aria-live="polite"
		@click.stop
	>
		<button
			v-if="canStart"
			type="button"
			class="narration-button"
			:disabled="isUnlocking"
			@click="start"
		>
			{{ isUnlocking ? 'Starting…' : 'Start narration' }}
		</button>
		<template v-else>
			<button
				v-if="state.status === 'playing'"
				type="button"
				class="narration-button"
				@click="pause"
			>
				Pause
			</button>
			<button
				v-else
				type="button"
				class="narration-button"
				@click="resume"
			>
				Resume
			</button>
			<button type="button" class="narration-button" @click="stop">
				Stop
			</button>
		</template>
		<span v-if="state.currentSegmentId" class="narration-segment">
			{{ state.currentSegmentId }}
		</span>
		<span v-if="displayedError" class="narration-error" role="alert">
			{{ displayedError }}
		</span>
	</div>
</template>

<style scoped>
.narration-controller {
	position: fixed;
	right: 0.75rem;
	bottom: 0.75rem;
	z-index: 50;
	display: flex;
	max-width: min(32rem, calc(100vw - 1.5rem));
	align-items: center;
	gap: 0.5rem;
	padding: 0.4rem 0.55rem;
	border: 1px solid rgb(148 163 184 / 35%);
	border-radius: 0.65rem;
	background: rgb(15 23 42 / 88%);
	color: white;
	font: 500 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
	box-shadow: 0 0.35rem 1rem rgb(15 23 42 / 18%);
	backdrop-filter: blur(0.5rem);
}

.narration-button {
	padding: 0.28rem 0.55rem;
	border: 1px solid rgb(226 232 240 / 35%);
	border-radius: 0.42rem;
	background: rgb(255 255 255 / 12%);
	color: inherit;
	cursor: pointer;
}

.narration-button:disabled {
	cursor: wait;
	opacity: 0.6;
}

.narration-segment {
	overflow: hidden;
	max-width: 13rem;
	color: rgb(203 213 225);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.narration-error {
	color: rgb(254 202 202);
}
</style>
