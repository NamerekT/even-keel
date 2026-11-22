import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import type { Profiler } from 'node:inspector'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { hottestFrames, saveStallProfile, StallProfiler } from './stall-profile.js'

const nodes = ['parse', 'parse', 'scan', '(idle)', 'parse'].map((functionName, i) => ({
  id: i + 1,
  callFrame: { functionName, scriptId: '1', url: 'file:///app/service.js', lineNumber: i === 4 ? 10 : 0, columnNumber: 0 },
}))
const profile: Profiler.Profile = {
  startTime: 0, endTime: 200_000, nodes,
  samples: [1, 2, 3, 3, 4, 5], timeDeltas: [20_000, 30_000, 7_000, 3_000, 100_000, 40_000],
}

it('ranks sampled self time across callers and distinguishes functions at different locations', () => {
  expect(hottestFrames(profile)).toBe('parse (service.js:1) 50 ms, parse (service.js:11) 40 ms, scan (service.js:1) 10 ms')
})

it('keeps the newest 20 captures across restarts alongside unrelated files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stall-'))
  const name = (n: number) => `stall-2026-01-01T00-00-${String(n).padStart(2, '0')}-000Z.cpuprofile`
  const others = ['start-2026.cpuprofile', 'stall-custom.cpuprofile', 'even-keel.log']
  const previous = Array.from({ length: 20 }, (_, i) => name(i))
  await Promise.all([...others, ...previous].map(file => writeFile(join(dir, file), 'old')))
  await saveStallProfile(dir, profile, new Date('2026-01-01T00:00:20Z'))
  expect((await readdir(dir)).sort()).toEqual([...others, ...previous.slice(1), name(20)].sort())
})

it('captures only an enabled, already sampled stall and rate-limits repeated writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stall-watch-'))
  const lines: string[] = []
  let enabled = false
  const profiler = new StallProfiler(dir, () => enabled, line => lines.push(line))
  try {
    await profiler.rotate(1200)
    enabled = true
    await profiler.rotate(1400)
    await profiler.rotate()
    expect(await readdir(dir)).toEqual([])
    await profiler.rotate(1600)
    await profiler.rotate(1800)
    expect(await readdir(dir)).toHaveLength(1)
    expect(lines).toEqual([expect.stringContaining('max delay 1600 ms')])
  } finally {
    enabled = false
    await profiler.rotate()
  }
})
