import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

describe('the demo mode by the defaultGit setting (EKR-108)', () => {
  let dir: string
  let git: ReturnType<typeof vi.fn<Git>>
  let addProject: ReturnType<typeof vi.fn<DemoDeps['addProject']>>
  let defaultGit: boolean | null

  const made = () =>
    new DemoService({
      stateDir: dir,
      git,
      config: () => ({ projects: {}, defaultGit }),
      language: () => 'en',
      homes: { setDemo: () => {} },
      refreshAccounts: async () => {},
      addProject,
      builtin: { create: async () => ({ id: `task-${Math.random()}` }), relate: async () => {} },
      startChain: async () => {},
      changed: () => {},
    } as unknown as DemoDeps)
  const draft = () => addProject.mock.calls[0]![0]

  beforeEach(() => {
    const temp = join(process.cwd(), '.temp')
    mkdirSync(temp, { recursive: true })
    dir = mkdtempSync(join(temp, 'demo-mode-'))
    git = vi.fn<Git>().mockResolvedValue({ code: 0, out: '' })
    addProject = vi.fn<DemoDeps['addProject']>().mockReturnValue('demo-id')
    defaultGit = null
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it.each([true, null])('makes a repository when defaultGit is %s and git starts', async (value) => {
    defaultGit = value
    const demo = made()
    await demo.start('en')

    expect(git.mock.calls.map(([, args]) => args[0])).toContain('commit')
    expect(draft().git).toBeUndefined()
    expect(existsSync(join(demo.repo, '.gitignore'))).toBe(true)
    expect(existsSync(join(demo.repo, 'README.md'))).toBe(true)
  })

  it('makes a folder without git and never calls git when defaultGit is false', async () => {
    defaultGit = false
    const demo = made()
    await demo.start('en')

    expect(git).not.toHaveBeenCalled()
    expect(draft()).toMatchObject({ git: false, key: 'DEMO', repo: demo.repo })
    expect(existsSync(join(demo.repo, 'README.md'))).toBe(true)
    expect(existsSync(join(demo.repo, '.gitignore'))).toBe(false)
  })

  it.each([true, null])('falls back to a folder without git when defaultGit is %s and git does not start', async (value) => {
    defaultGit = value
    git.mockResolvedValue({ code: -1, out: 'spawn git ENOENT', missing: true })
    const demo = made()

    await expect(demo.start('en')).resolves.toBe('demo-id')

    expect(git).toHaveBeenCalledTimes(1)
    expect(draft()).toMatchObject({ git: false, repo: demo.repo })
    expect(readFileSync(join(demo.repo, 'README.md'), 'utf8')).toContain('Harbor log')
    expect(existsSync(join(demo.repo, '.gitignore'))).toBe(false)
  })

  it('picks the mode anew when started again', async () => {
    defaultGit = false
    const demo = made()
    await demo.start('en')
    expect(draft().git).toBe(false)

    defaultGit = null
    addProject.mockClear()
    await demo.again('en')
    expect(draft().git).toBeUndefined()
    expect(git).toHaveBeenCalled()
    expect(existsSync(join(demo.repo, '.gitignore'))).toBe(true)
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
