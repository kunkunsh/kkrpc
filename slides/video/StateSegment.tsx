import { AbsoluteFill, CanvasImage, interpolate, useCurrentFrame } from 'remotion'

export interface StateSegmentProps {
	currentImage: string
	previousImage: string | null
	transitionFrames: number
}

const imageProps = {
	width: 1920,
	height: 1080,
	fit: 'contain' as const,
	style: {
		position: 'absolute' as const,
		inset: 0
	}
}

export function StateSegment({ currentImage, previousImage, transitionFrames }: StateSegmentProps) {
	const frame = useCurrentFrame()
	const shouldTransition = previousImage !== null && transitionFrames > 0
	const transitionComplete = !shouldTransition || frame >= transitionFrames

	return (
		<AbsoluteFill style={{ backgroundColor: '#000' }}>
			{shouldTransition && !transitionComplete ? (
				<CanvasImage src={previousImage} {...imageProps} />
			) : null}
			<CanvasImage
				src={currentImage}
				{...imageProps}
				style={{
					...imageProps.style,
					opacity: shouldTransition
						? interpolate(frame, [0, transitionFrames], [0, 1], {
								extrapolateLeft: 'clamp',
								extrapolateRight: 'clamp'
							})
						: 1
				}}
			/>
		</AbsoluteFill>
	)
}
