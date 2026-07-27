import path from 'node:path'

export const projectRoot = process.cwd()
export const narrationSourcePath = path.join(projectRoot, 'narration/script.yaml')
export const generatedDirectory = path.join(projectRoot, 'narration/generated')
export const generatedTimelinePath = path.join(generatedDirectory, 'timeline.json')
export const generatedStatesDirectory = path.join(generatedDirectory, 'states')
export const publicDirectory = path.join(projectRoot, 'public')
export const videoOutputPath = path.join(projectRoot, 'dist/narrated-slides.mp4')
