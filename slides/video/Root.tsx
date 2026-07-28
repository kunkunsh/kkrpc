import { Composition } from 'remotion'
import { NarratedSlides } from './NarratedSlides'
import { timeline } from './timeline'

export function RemotionRoot() {
	return (
		<Composition
			id="NarratedSlides"
			component={NarratedSlides}
			width={1920}
			height={1080}
			fps={30}
			durationInFrames={timeline.durationInFrames}
		/>
	)
}
