import { writeSync } from 'node:fs'
import { missingPackageLine, missingPackageOf } from './diagnostics/missing-package.js'

// The service's packages are resolved when its modules load, before a line of theirs runs: a dependency a merged commit
// added and nobody installed yet fails the start here, with one line saying what to do instead of a stack (BTN-1239).
try {
  await import('./start.js')
} catch (error) {
  const name = missingPackageOf(error)
  if (name === undefined) throw error
  writeSync(2, `${missingPackageLine(name, process.cwd())}\n`)
  process.exit(1)
}
