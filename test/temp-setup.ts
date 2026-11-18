import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunRoot, removeRunRoot, RUNS_FOLDER, sweepRuns, TEMP_KEYS } from './temp-root.js'

/**
 * The run's own temp folder (docs/storage.md, "Tests"). Runs before the other global setups: the workers and their
 * child processes take `process.env` when the pool starts, so `os.tmpdir()` points into the root everywhere.
 */
export default function setup(): () => void {
  const base = join(tmpdir(), RUNS_FOLDER)
  sweepRuns(base)
  const root = createRunRoot(base)
  const saved = TEMP_KEYS.map((key) => [key, process.env[key]] as const)
  for (const key of TEMP_KEYS) process.env[key] = root
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    const left = removeRunRoot(root)
    if (left > 0) console.warn(`test temp root ${root}: ${left} entries left behind, the next run removes them`)
  }
}
