import { Children, isValidElement, type ReactElement } from 'react'
import { Sequence } from 'remotion'
import { describe, expect, it } from 'vitest'
import type { CompiledTimeline, CompiledTimelineEntry } from '../../components/narration/types'
import { NarratedSlides } from '../../video/NarratedSlides'
import { StateSegment } from '../../video/StateSegment'
import { getEntryAudioStartFrame, validateCompiledTimeline } from '../../video/timeline'

function entry(overrides: Partial<CompiledTimelineEntry> = {}): CompiledTimelineEntry {
	return {
		id: 'intro',
		index: 0,
		page: 1,
		click: 0,
		text: 'Intro',
		audioPublicPath: 'narration/audio/intro.mp3',
		audioDurationMs: 500,
		silentMs: 0,
		transitionMs: 300,
		leadInMs: 100,
		tailMs: 100,
		transitionFrames: 9,
		leadInFrames: 3,
		audioFrames: 15,
		tailFrames: 3,
		startFrame: 0,
		durationInFrames: 30,
		stateImagePublicPath: 'narration/generated/states/s001-c000.png',
		...overrides
	}
}

function timeline(
	entries: CompiledTimelineEntry[],
	overrides: Partial<CompiledTimeline> = {}
): CompiledTimeline {
	return {
		version: 1,
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: entries.reduce(
			(duration, timelineEntry) => duration + timelineEntry.durationInFrames,
			0
		),
		entries,
		...overrides
	}
}

describe('Remotion compiled timeline', () => {
	it('starts audio after transition and lead-in', () => {
		expect(
			getEntryAudioStartFrame({
				startFrame: 100,
				transitionFrames: 9,
				leadInFrames: 3
			})
		).toBe(112)
	})

	it('accepts a complete contiguous timeline', () => {
		const entries = [
			entry(),
			entry({
				id: 'detail',
				index: 1,
				click: 1,
				startFrame: 30,
				audioPublicPath: null,
				audioDurationMs: 0,
				silentMs: 500,
				stateImagePublicPath: 'narration/generated/states/s001-c001.png'
			})
		]

		expect(() => validateCompiledTimeline(timeline(entries))).not.toThrow()
	})

	it('rejects non-contiguous compiled entries', () => {
		const entries = [
			entry(),
			entry({
				id: 'detail',
				index: 1,
				click: 1,
				startFrame: 31
			})
		]

		expect(() => validateCompiledTimeline(timeline(entries, { durationInFrames: 60 }))).toThrow(
			/contiguous/
		)
	})

	it('rejects a timeline that does not start at frame zero', () => {
		expect(() =>
			validateCompiledTimeline(timeline([entry({ startFrame: 1 })], { durationInFrames: 31 }))
		).toThrow(/frame 0/)
	})

	it('rejects a timeline whose declared duration does not cover its entries exactly', () => {
		expect(() => validateCompiledTimeline(timeline([entry()], { durationInFrames: 31 }))).toThrow(
			/durationInFrames/
		)
	})

	it('rejects incompatible composition metadata', () => {
		expect(() => validateCompiledTimeline(timeline([entry()], { width: 1280 }))).toThrow(
			/1920x1080/
		)
	})

	it('rejects an entry with an invalid public asset path', () => {
		expect(() =>
			validateCompiledTimeline(timeline([entry({ stateImagePublicPath: '../outside-public.png' })]))
		).toThrow(/stateImagePublicPath/)
	})

	it('rejects an entry that declares both audio and silence', () => {
		expect(() => validateCompiledTimeline(timeline([entry({ silentMs: 500 })]))).toThrow(
			/audioPublicPath.*silentMs/
		)
	})

	it('rejects narrated audio that rounds down to a zero-frame sequence', () => {
		expect(() =>
			validateCompiledTimeline(timeline([entry({ audioFrames: 0, durationInFrames: 15 })]))
		).toThrow(/audioFrames.*positive/)
	})
})

describe('NarratedSlides composition plan', () => {
	it('contains each state only within its compiled entry sequence', () => {
		const entries = [
			entry(),
			entry({
				id: 'pause',
				index: 1,
				click: 1,
				startFrame: 30,
				audioPublicPath: null,
				audioDurationMs: 0,
				silentMs: 500,
				stateImagePublicPath: 'narration/generated/states/s001-c001.png'
			})
		]
		const composition = NarratedSlides({ timeline: timeline(entries) })
		const sequences = Children.toArray(composition.props.children).filter(isValidElement)

		expect(
			sequences.map((sequence) => ({
				type: sequence.type,
				from: sequence.props.from,
				durationInFrames: sequence.props.durationInFrames
			}))
		).toEqual([
			{ type: Sequence, from: 0, durationInFrames: 30 },
			{ type: Sequence, from: 30, durationInFrames: 30 }
		])

		const firstChildren = Children.toArray(sequences[0].props.children).filter(isValidElement)
		const secondChildren = Children.toArray(sequences[1].props.children).filter(isValidElement)
		const firstState = firstChildren[0] as ReactElement<{
			currentImage: string
			previousImage: string | null
		}>
		const secondState = secondChildren[0] as ReactElement<{
			currentImage: string
			previousImage: string | null
		}>

		expect(firstState.type).toBe(StateSegment)
		expect(firstState.props).toMatchObject({
			currentImage: '/narration/generated/states/s001-c000.png',
			previousImage: null
		})
		expect(secondState.type).toBe(StateSegment)
		expect(secondState.props).toMatchObject({
			currentImage: '/narration/generated/states/s001-c001.png',
			previousImage: '/narration/generated/states/s001-c000.png'
		})
	})

	it('adds delayed audio only to narrated entries', () => {
		const entries = [
			entry(),
			entry({
				id: 'pause',
				index: 1,
				click: 1,
				startFrame: 30,
				audioPublicPath: null,
				audioDurationMs: 0,
				silentMs: 500,
				stateImagePublicPath: 'narration/generated/states/s001-c001.png'
			})
		]
		const composition = NarratedSlides({ timeline: timeline(entries) })
		const sequences = Children.toArray(composition.props.children).filter(isValidElement)
		const narratedChildren = Children.toArray(sequences[0].props.children).filter(isValidElement)
		const silentChildren = Children.toArray(sequences[1].props.children).filter(isValidElement)
		const audioSequence = narratedChildren[1]

		expect(audioSequence.type).toBe(Sequence)
		expect(audioSequence.props.from).toBe(12)
		expect(audioSequence.props.durationInFrames).toBe(15)
		expect(silentChildren).toHaveLength(1)
	})
})
