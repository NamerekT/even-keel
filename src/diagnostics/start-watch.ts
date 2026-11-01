import { mkdirSync, writeFileSync } from 'node:fs'
import { Session } from 'node:inspector/promises'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'

/** The part of `perf_hooks`' histogram the watch reads; values are in nanoseconds. */
export interface DelayHistogram {
  enable(): void
  disable(): void
  readonly max: number
  percentile(percentile: number): number
  reset(): void
}

export interface DelayWindow {
  /** Milliseconds. */
  max: number
  /** Milliseconds. */
  p99: number
}

/** The log line of a window whose longest delay of the event loop reached the threshold; nothing for a calm one. */
export function stallLine(window: DelayWindow, everyMs: number, thresholdMs: number): string | undefined {
  if (window.max < thresholdMs) return undefined
  return `event loop: blocked up to ${Math.round(window.max)} ms in the last ${everyMs / 1000} s (p99 ${Math.round(window.p99)} ms)`
}

export interface LoopWatch {
  forMs: number
  everyMs: number
  thresholdMs: number
  log: (line: string) => void
  histogram?: DelayHistogram
}

/**
 * Logs the delay of the event loop for a while after the start, a window only when it was blocked past the threshold,
 * and a summary at the end when any was: what holds the thread shows in the log next to the calls that timed out.
 */
export function watchLoopDelay(watch: LoopWatch): void {
  const histogram = watch.histogram ?? monitorEventLoopDelay({ resolution: 20 })
  histogram.enable()
  let stalls = 0
  let longest = 0
  let elapsed = 0
  const timer = setInterval(() => {
    const window = { max: histogram.max / 1e6, p99: histogram.percentile(99) / 1e6 }
    histogram.reset()
    elapsed += watch.everyMs
    const line = stallLine(window, watch.everyMs, watch.thresholdMs)
    if (line !== undefined) {
      stalls += 1
      longest = Math.max(longest, window.max)
      watch.log(line)
    }
    if (elapsed < watch.forMs) return
    clearInterval(timer)
    histogram.disable()
    if (stalls > 0)
      watch.log(`event loop: the first ${watch.forMs / 1000} s had ${stalls} window${stalls === 1 ? '' : 's'} over ${watch.thresholdMs} ms, the longest ${Math.round(longest)} ms`)
  }, watch.everyMs)
  timer.unref()
}

const MAX_PROFILE_SECONDS = 600

/** `EVEN_KEEL_CPU_PROFILE`: how many seconds of the start to profile, at most ten minutes; nothing when unset or not a positive number. */
export function profileSecondsOf(env: NodeJS.ProcessEnv): number | undefined {
  const seconds = Number.parseInt(env.EVEN_KEEL_CPU_PROFILE ?? '', 10)
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  return Math.min(seconds, MAX_PROFILE_SECONDS)
}

/**
 * Profiles the process's own CPU for the first seconds of the start, through an in-process inspector session (no port
 * opens), and writes `logs/start-<time>.cpuprofile` for Chrome DevTools or VS Code.
 */
export async function profileStart(seconds: number, logsDir: string, log: (line: string) => void): Promise<void> {
  const session = new Session()
  session.connect()
  await session.post('Profiler.enable')
  await session.post('Profiler.setSamplingInterval', { interval: 1_000 })
  await session.post('Profiler.start')
  log(`cpu profile: recording the first ${seconds} s of the start`)
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const { profile } = await session.post('Profiler.stop')
        mkdirSync(logsDir, { recursive: true })
        const file = join(logsDir, `start-${new Date().toISOString().replace(/[:.]/g, '-')}.cpuprofile`)
        writeFileSync(file, JSON.stringify(profile))
        log(`cpu profile: written to ${file}`)
      } catch (error) {
        log(`cpu profile: not written: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        session.disconnect()
      }
    })()
  }, seconds * 1000)
  timer.unref()
}
