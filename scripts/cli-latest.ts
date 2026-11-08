import { appendFileSync } from 'node:fs'
import { resolveLatest } from '../src/e2e-cli/latest.fixture.js'

function output(name: string, value: string): void {
  console.log(`${name}=${value}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

resolveLatest(process.argv[2], output).catch((error: unknown) => {
  console.error(`cli-latest: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
