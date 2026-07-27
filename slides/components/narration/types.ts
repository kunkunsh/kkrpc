export interface CompiledTimeline {
	version: 1
	fps: 30
	width: 1920
	height: 1080
	durationInFrames: number
	entries: CompiledTimelineEntry[]
}

export interface CompiledTimelineEntry {
	id: string
	index: number
	page: number
	click: number
	text: string
	audioPublicPath: string | null
	audioDurationMs: number
	silentMs: number
	transitionMs: number
	leadInMs: number
	tailMs: number
	transitionFrames: number
	leadInFrames: number
	audioFrames: number
	tailFrames: number
	startFrame: number
	durationInFrames: number
	stateImagePublicPath: string
}
