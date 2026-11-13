import { describe, expect, it } from 'vitest'
import { excludedEndToEnd } from './vitest-scope.js'

const ALL = ['src/e2e/**', 'src/e2e-cli/**', 'src/e2e-trackers/**']

describe('excludedEndToEnd', () => {
  it('leaves every end-to-end folder out of a bare run', () => {
    expect(excludedEndToEnd(['run'], 'test')).toEqual(ALL)
    expect(excludedEndToEnd(['run', 'src/chain/', '--shard=1/3'], 'test')).toEqual(ALL)
  })

  it('keeps a folder the run names, in any spelling of the path', () => {
    expect(excludedEndToEnd(['run', 'src/e2e/'], 'test')).toEqual(['src/e2e-cli/**', 'src/e2e-trackers/**'])
    expect(excludedEndToEnd(['run', 'src/e2e/ci-fix'], 'test')).toEqual(['src/e2e-cli/**', 'src/e2e-trackers/**'])
    expect(excludedEndToEnd(['run', 'src/e2e'], 'test')).toEqual(['src/e2e-cli/**', 'src/e2e-trackers/**'])
    expect(excludedEndToEnd(['run', 'src\\e2e-cli\\opencode.test.ts'], 'test')).toEqual(['src/e2e/**', 'src/e2e-trackers/**'])
    expect(excludedEndToEnd(['run', 'D:/repo/src/e2e-trackers/'], 'test')).toEqual(['src/e2e/**', 'src/e2e-cli/**'])
  })

  it('does not take a neighbour folder for a named one', () => {
    expect(excludedEndToEnd(['run', 'src/e2e-cli/'], 'test')).toEqual(['src/e2e/**', 'src/e2e-trackers/**'])
    expect(excludedEndToEnd(['run', 'src/e2e-fixtures.ts'], 'test')).toEqual(ALL)
  })

  it('keeps everything under the mode all', () => {
    expect(excludedEndToEnd(['run', '--mode', 'all'], 'all')).toEqual([])
  })
})
