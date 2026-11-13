import type { CloneProgress, JobStep } from '../../../src/state.js'
import { formatClock } from '../format.js'
import { t } from '../i18n/index.js'

/** A clone's figures: the stage, the objects the server listed, the percent, the size and speed; a bare stage ends in "…". */
export function progressText(progress: CloneProgress): string {
  const texts = t.creation.window
  // The LFS files are a step of their own: its name says the stage.
  const parts = progress.stage === 'lfs' ? [] : [texts.stages[progress.stage]]
  if (progress.objects !== undefined) parts[0] = `${parts[0]}: ${texts.objects(progress.objects)}`
  if (progress.percent !== undefined) parts.push(`${progress.percent}%`)
  if (progress.bytes !== undefined) parts.push(texts.received(progress.bytes, progress.speed))
  if (progress.percent === undefined && progress.objects === undefined) return `${parts.join(' · ')}…`
  return parts.join(' · ')
}

/** How long a step has run, up to now while it runs (BTN-1099); `null` before it began or when it took under a second. */
export function stepTime(step: JobStep, now: Date): string | null {
  if (step.startedAt === undefined) return null
  const end = step.state === 'running' ? now.getTime() : step.endedAt === undefined ? null : Date.parse(step.endedAt)
  if (end === null) return null
  const length = end - Date.parse(step.startedAt)
  if (step.state !== 'running' && length < 1000) return null
  return formatClock(length)
}
