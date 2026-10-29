import { join } from 'node:path'
import { root } from '../src/locations.js'
import { compareSamples, loadSamples } from './cli-samples.js'

const [provider, before, after] = process.argv.slice(2)
if (![provider, before, after].every((part) => part !== undefined && /^[a-z0-9][a-z0-9.+_-]*$/i.test(part))) {
  throw new Error('usage: npm run cli-compare -- <provider> <before-version> <after-version>')
}
const samples = join(root, 'test/fixtures/cli', provider!)
console.log(JSON.stringify(compareSamples(loadSamples(join(samples, before!)), loadSamples(join(samples, after!))), null, 2))
