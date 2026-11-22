import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import type { Profiler } from 'node:inspector'
import { Session } from 'node:inspector/promises'
import { basename, join } from 'node:path'

const CAPTURE_INTERVAL_MS = 60 * 60_000
const STALL_FILE = /^stall-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.cpuprofile$/

export function hottestFrames(profile: Profiler.Profile): string {
  const nodes = new Map(profile.nodes.map(node => [node.id, node.callFrame]))
  const times = new Map<string, { label: string; us: number }>()
  for (const [i, id] of (profile.samples ?? []).entries()) {
    const frame = nodes.get(id)
    if (!frame || frame.functionName === '(idle)' || frame.functionName === '(root)') continue
    const key = JSON.stringify([frame.scriptId, frame.lineNumber, frame.columnNumber, frame.functionName])
    let entry = times.get(key)
    if (!entry) {
      const location = frame.url ? ` (${basename(frame.url)}:${frame.lineNumber + 1})` : ''
      entry = { label: (frame.functionName || '(anonymous)') + location, us: 0 }
      times.set(key, entry)
    }
    entry.us += Math.max(0, profile.timeDeltas?.[i] ?? 0)
  }
  return [...times.values()].sort((a, b) => b.us - a.us).slice(0, 5)
    .map(({ label, us }) => `${label} ${Math.round(us / 1000)} ms`).join(', ') || 'no active samples'
}

export async function saveStallProfile(dir: string, profile: Profiler.Profile, at: Date): Promise<string> {
  const name = `stall-${at.toISOString().replace(/[:.]/g, '-')}.cpuprofile`
  await mkdir(dir, { recursive: true })
  const pending = join(dir, `.stall-${process.pid}.tmp`)
  try {
    await writeFile(pending, JSON.stringify(profile))
    await rename(pending, join(dir, name))
  } catch (error) {
    await rm(pending, { force: true })
    throw error
  }
  const files = (await readdir(dir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && STALL_FILE.test(entry.name)).map(entry => entry.name).sort()
  for (const old of files.slice(0, -20)) await rm(join(dir, old), { force: true })
  return name
}

/** The histogram tick closes the profile that was already running when the loop stalled. */
export class StallProfiler {
  private session?: Session
  private nextSave = 0
  private writing = false

  constructor(private readonly dir: string, private readonly enabled: () => boolean, private readonly log: (line: string) => void) {}

  async rotate(stallMs?: number): Promise<void> {
    let profile: Profiler.Profile | undefined
    try {
      if (!this.enabled()) {
        this.disconnect()
        return
      }
      if (this.session) {
        profile = (await this.session.post('Profiler.stop')).profile
      } else {
        this.session = new Session()
        this.session.connect()
        await this.session.post('Profiler.enable')
        await this.session.post('Profiler.setSamplingInterval', { interval: 10_000 })
      }
      await this.session.post('Profiler.start')
    } catch (error) {
      this.disconnect()
      this.log(`stall profile: ${String(error)}`)
      return
    }
    const now = performance.now()
    if (!profile || stallMs === undefined || this.writing || now < this.nextSave) return
    this.nextSave = now + CAPTURE_INTERVAL_MS
    this.writing = true
    try {
      const file = await saveStallProfile(this.dir, profile, new Date())
      this.log(`stall profile: ${file} (max delay ${Math.round(stallMs)} ms), self time: ${hottestFrames(profile)}`)
    } catch (error) {
      this.log(`stall profile: could not save the window: ${String(error)}`)
    } finally {
      this.writing = false
    }
  }

  private disconnect(): void {
    this.session?.disconnect()
    this.session = undefined
  }
}
