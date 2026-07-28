import { describe, expect, it } from "vitest"
import type { CompiledTimelineEntry } from "../../components/narration/types"
import { stateFileName, uniqueStates } from "../../scripts/narration/capture-states"

function timelineEntry(page: number, click: number, id: string): CompiledTimelineEntry {
	return {
		id,
		index: 0,
		page,
		click,
		text: "",
		audioPublicPath: null,
		audioDurationMs: 0,
		silentMs: 0,
		transitionMs: 300,
		leadInMs: 100,
		tailMs: 150,
		transitionFrames: 9,
		leadInFrames: 3,
		audioFrames: 0,
		tailFrames: 5,
		startFrame: 0,
		durationInFrames: 17,
		stateImagePublicPath: ""
	}
}

describe("stateFileName", () => {
	it("pads slide and click numbers to stable three-digit fields", () => {
		expect(stateFileName(2, 7)).toBe("s002-c007.png")
		expect(stateFileName(123, 456)).toBe("s123-c456.png")
	})
})

describe("uniqueStates", () => {
	it("returns duplicate states once in first-appearance order", () => {
		const entries = [
			timelineEntry(2, 1, "first"),
			timelineEntry(1, 0, "second"),
			timelineEntry(2, 1, "duplicate"),
			timelineEntry(2, 2, "third"),
			timelineEntry(1, 0, "duplicate-again")
		]

		expect(uniqueStates(entries)).toEqual([
			{ page: 2, click: 1 },
			{ page: 1, click: 0 },
			{ page: 2, click: 2 }
		])
	})
})
