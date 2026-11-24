import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sharedMemory } from '../account/share.js'
import { parseConfig } from '../config.js'
import { machineMemoryFolders } from './memory.js'

const GLOBAL = join('/home/john/.claude')
const configWith = (projects: Record<string, string>) => ({ ...parseConfig({ projects: [] }), projects })

describe('machineMemoryFolders', () => {
  it('gives each project of the pool its folder and adds the bound folders, one memory folder each', () => {
    const folders = machineMemoryFolders(
      {
        config: configWith({ p1: '/work/alpha', p2: '/work/beta' }),
        memory: [
          { project: 'p1', folder: '/work/alpha-release' },
          { project: 'p1', folder: '/work/alpha' },
          { project: 'p3', folder: '/elsewhere/gamma' },
        ],
      },
      GLOBAL,
    )
    expect(folders).toEqual({
      p1: [sharedMemory(GLOBAL, '/work/alpha'), sharedMemory(GLOBAL, '/work/alpha-release')],
      p2: [sharedMemory(GLOBAL, '/work/beta')],
      p3: [sharedMemory(GLOBAL, '/elsewhere/gamma')],
    })
  })

  it('syncs nothing beyond the pool without a binding', () => {
    expect(machineMemoryFolders({ config: configWith({}) }, GLOBAL)).toEqual({})
  })
})
