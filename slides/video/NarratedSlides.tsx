import { Audio } from '@remotion/media'
import { Fragment } from 'react'
import { Sequence, staticFile } from 'remotion'
import type { CompiledTimeline } from '../components/narration/types'
import { StateSegment } from './StateSegment'
import { getEntryAudioStartFrame, timeline as defaultTimeline } from './timeline'

export interface NarratedSlidesProps {
	timeline?: CompiledTimeline
}

export function NarratedSlides({ timeline = defaultTimeline }: NarratedSlidesProps = {}) {
	return (
		<Fragment>
			{timeline.entries.map((entry, index) => {
				const previousEntry = timeline.entries[index - 1] ?? null
				const audioStartFrame = getEntryAudioStartFrame(entry) - entry.startFrame

				return (
					<Sequence
						key={entry.id}
						name={`${entry.id}: state`}
						from={entry.startFrame}
						durationInFrames={entry.durationInFrames}
					>
						<StateSegment
							currentImage={staticFile(entry.stateImagePublicPath)}
							previousImage={
								previousEntry === null ? null : staticFile(previousEntry.stateImagePublicPath)
							}
							transitionFrames={entry.transitionFrames}
						/>
						{entry.audioPublicPath === null ? null : (
							<Sequence
								name={`${entry.id}: audio`}
								from={audioStartFrame}
								durationInFrames={entry.audioFrames}
								layout="none"
							>
								<Audio src={staticFile(entry.audioPublicPath)} />
							</Sequence>
						)}
					</Sequence>
				)
			})}
		</Fragment>
	)
}
