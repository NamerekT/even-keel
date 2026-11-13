import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EvenKeelConfig } from '../config.js'
import type { Git } from '../git/types.js'
import { samePath } from '../paths.js'
import { DemoService, type DemoDeps } from './service.js'

vi.mock('../paths.js', async (original) => {
  const paths = await original<typeof import('../paths.js')>()
  return { ...paths, samePath: vi.fn(paths.samePath) }
})

const stateDir = join('/', 'srv', 'even-keel', 'state')

describe('failed demo repository preparation', () => {
  let dir: string
  let demo: DemoService
  let git: ReturnType<typeof vi.fn<Git>>
  let addProject: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const temp = join(process.cwd(), '.temp')
    mkdirSync(temp, { recursive: true })
    dir = mkdtempSync(join(temp, 'demo-init-'))
    git = vi.fn<Git>().mockResolvedValue({ code: 0, out: '' })
    addProject = vi.fn()
    demo = new DemoService({
      stateDir: dir,
      git,
      config: () => ({ projects: {} }),
      homes: { setDemo: () => {} },
      addProject,
    } as unknown as DemoDeps)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it.each(['init', 'config', 'add', 'commit'])('removes the whole demo folder when git %s fails', async (command) => {
    mkdirSync(join(demo.dir, 'account'), { recursive: true })
    writeFileSync(join(demo.dir, 'account', 'sessions.json'), '{}')
    git.mockImplementation(async (_cwd, args) => args[0] === command ? { code: 1, out: 'git failed' } : { code: 0, out: '' })

    await expect(demo.start('en')).rejects.toMatchObject({ notice: { code: 'git.initFailed' } })

    expect(existsSync(demo.dir)).toBe(false)
    expect(addProject).not.toHaveBeenCalled()
  })

  it('removes the folder when the git call throws and allows another attempt', async () => {
    const error = new Error('git call failed')
    git.mockRejectedValueOnce(error).mockResolvedValueOnce({ code: 1, out: 'still unavailable' })

    await expect(demo.start('en')).rejects.toBe(error)
    expect(existsSync(demo.dir)).toBe(false)
    await expect(demo.start('en')).rejects.toMatchObject({ notice: { code: 'git.initFailed' } })
    expect(existsSync(demo.dir)).toBe(false)
    expect(git).toHaveBeenCalledTimes(2)
    expect(addProject).not.toHaveBeenCalled()
  })

  it('removes the folder when writing the repository files fails', async () => {
    git.mockImplementation(async () => {
      mkdirSync(join(demo.repo, 'README.md'), { recursive: true })
      return { code: 0, out: '' }
    })

    await expect(demo.start('en')).rejects.toThrow()

    expect(existsSync(demo.dir)).toBe(false)
    expect(addProject).not.toHaveBeenCalled()
  })
})

describe('the demo project lookup', () => {
  let config: EvenKeelConfig
  let demo: DemoService

  beforeEach(() => {
    vi.mocked(samePath).mockClear()
    demo = new DemoService({ stateDir, config: () => config, homes: { setDemo: () => {} } } as unknown as DemoDeps)
    config = { projects: { other: join('/', 'srv', 'repos', 'other'), demo: demo.repo } } as unknown as EvenKeelConfig
  })

  it('compares the paths once per config, not on every call', () => {
    for (let call = 0; call < 5; call++) expect(demo.project()).toBe('demo')
    expect(demo.owns('demo')).toBe(true)
    expect(demo.owns('other')).toBe(false)
    expect(vi.mocked(samePath).mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('finds the project anew once the config changes', () => {
    expect(demo.project()).toBe('demo')
    config = { projects: { other: config.projects.other! } } as unknown as EvenKeelConfig
    expect(demo.project()).toBeUndefined()
    config = { projects: { again: demo.repo } } as unknown as EvenKeelConfig
    expect(demo.project()).toBe('again')
  })
})
