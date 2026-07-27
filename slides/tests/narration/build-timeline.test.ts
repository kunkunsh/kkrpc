import { describe, expect, it } from 'vitest'
import { validateManifest } from '../../scripts/narration/schema'

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
})
