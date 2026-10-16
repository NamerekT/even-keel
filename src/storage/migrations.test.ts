import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { root } from '../locations.js'
import { noticeOf } from '../notice/notice.js'
import { writeAtomic } from './atomic.js'
import { upgradeStorage } from './migrations.js'
import { SCHEMA_VERSION } from './schema.js'

describe('upgradeStorage', () => {
  let dir: string
  let stateDir: string
  let configFile: string
  let logs: string[]
  let ids: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-storage-'))
    stateDir = join(dir, 'state')
    mkdirSync(stateDir)
    configFile = join(dir, 'even-keel.config.json')
    logs = []
    ids = 0
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const state = (name: string) => join(stateDir, name)
  const put = (file: string, value: unknown) => writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2))
  const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
  const text = (file: string) => readFileSync(file, 'utf8')
  const upgrade = (write?: (file: string, text: string) => void) =>
    upgradeStorage({ configFile, stateDir, log: (line) => logs.push(line), newId: () => `guid-${++ids}`, write })
  const codeOf = (run: () => void) => {
    try {
      run()
    } catch (error) {
      return noticeOf(error).code
    }
    return undefined
  }

  const v1Config = { language: 'en', projects: { ABC: 'C:\\abc', XYZ: { repo: 'C:\\xyz', name: 'Xyz', slot: 2 } } }
  const v1Chain = {
    active: [{ project: 'ABC', current: null, paused: false, error: null }],
    queue: ['XYZ'],
    orders: { ABC: ['ABC-1', 'ABC-2'], XYZ: ['XYZ-3'] },
    skipped: { ABC: ['ABC-9'] },
    leftovers: { XYZ: [{ task: 'XYZ-1', at: '2026-10-01T00:00:00.000Z', notice: { code: 'text', params: { text: 'dirty' } } }] },
    released: { ABC: ['ABC-5'] },
    unattended: false,
    trimTools: true,
    ci: { ABC: { green: 'abc123', fix: { task: 'ABC-FIX', at: '2026-10-01T00:00:00.000Z', commit: 'def456' } } },
  }
  const v1Questions = [{ task: 'ABC-1', sessionId: 's1', ask: 'a1', comment: 'c1' }]
  const v1Launches = [
    { at: '2026-10-01T00:00:00.000Z', project: 'ABC', task: 'ABC-1', sessionId: 's1' },
    { at: '2026-10-02T00:00:00.000Z', project: 'XYZ', task: 'XYZ-3', sessionId: 's2', reason: 'restart' },
  ]
  const v1Account = { active: 'global', accounts: {}, removing: [] }

  const putV1 = () => {
    put(configFile, v1Config)
    put(state('chain.json'), v1Chain)
    put(state('questions.json'), v1Questions)
    put(state('launches.jsonl'), v1Launches.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    put(state('account.json'), v1Account)
  }
  const originals = () => ['even-keel.config.json', 'state/chain.json', 'state/questions.json', 'state/launches.jsonl', 'state/account.json'].map((name) => text(join(dir, name)))

  describe('v1 to v2', () => {
    it('turns the projects object into an array of records in the same order, each with a GUID', () => {
      putV1()
      upgrade()
      const config = json(configFile)
      expect(Object.keys(config)[0]).toBe('version')
      expect(config).toEqual({
        version: SCHEMA_VERSION,
        language: 'en',
        projects: [
          { id: 'guid-1', key: 'ABC', repo: 'C:\\abc' },
          { id: 'guid-2', key: 'XYZ', repo: 'C:\\xyz', name: 'Xyz', slot: 2 },
        ],
      })
    })

    it('names the projects of chain.json by their ids', () => {
      putV1()
      upgrade()
      const chain = json(state('chain.json'))
      expect(chain.version).toBe(SCHEMA_VERSION)
      expect(chain.active[0].project).toBe('guid-1')
      expect(chain.queue).toEqual(['guid-2'])
      expect(Object.keys(chain.orders)).toEqual(['guid-1', 'guid-2'])
      expect(chain.orders['guid-1']).toEqual(['ABC-1', 'ABC-2'])
      expect(Object.keys(chain.skipped)).toEqual(['guid-1'])
      expect(Object.keys(chain.leftovers)).toEqual(['guid-2'])
      expect(Object.keys(chain.released)).toEqual(['guid-1'])
      expect(chain.ci).toEqual({ 'guid-1': v1Chain.ci.ABC })
    })

    it('wraps the questions, rewrites the launches with ids under a version line and stamps the account file', () => {
      putV1()
      upgrade()
      expect(json(state('questions.json'))).toEqual({ version: SCHEMA_VERSION, questions: v1Questions })
      const lines = text(state('launches.jsonl')).trim().split('\n').map((line) => JSON.parse(line))
      expect(lines).toEqual([{ version: SCHEMA_VERSION }, { ...v1Launches[0], project: 'guid-1' }, { ...v1Launches[1], project: 'guid-2' }])
      expect(json(state('account.json'))).toEqual({ version: SCHEMA_VERSION, ...v1Account })
    })

    it('keeps a copy of every file it rewrites and says so in the log', () => {
      putV1()
      const before = originals()
      upgrade()
      const copies = ['even-keel.config.json', 'state/chain.json', 'state/questions.json', 'state/launches.jsonl', 'state/account.json'].map((name) =>
        text(join(dir, `${name}.v1.bak`)),
      )
      expect(copies).toEqual(before)
      expect(logs).toHaveLength(5)
      expect(logs[0]).toContain('v1')
    })

    it('migrates the files that are there and leaves out the missing ones', () => {
      put(configFile, v1Config)
      upgrade()
      expect(json(configFile).version).toBe(SCHEMA_VERSION)
      expect(existsSync(state('chain.json'))).toBe(false)
      expect(existsSync(state('launches.jsonl'))).toBe(false)
    })

    it('stamps a config that already has the projects array', () => {
      put(configFile, { projects: [{ id: 'id-abc', key: 'ABC', repo: 'C:\\abc' }] })
      put(state('chain.json'), { ...v1Chain, active: [], queue: [], orders: { ABC: [] }, skipped: {}, leftovers: {}, released: {}, ci: {} })
      upgrade()
      expect(json(configFile)).toEqual({ version: SCHEMA_VERSION, projects: [{ id: 'id-abc', key: 'ABC', repo: 'C:\\abc' }] })
      expect(json(state('chain.json')).orders).toEqual({ 'id-abc': [] })
    })

    it('does nothing the second time', () => {
      putV1()
      upgrade()
      const after = originals()
      logs = []
      upgrade()
      expect(originals()).toEqual(after)
      expect(logs).toEqual([])
    })
  })

  describe('v2 to v3', () => {
    const v2 = join(root, 'test', 'fixtures', 'schema-v2')
    const names = ['even-keel.config.json', 'state/chain.json', 'state/questions.json', 'state/launches.jsonl', 'state/account.json']

    it('stamps every file with the new version and changes nothing else', () => {
      cpSync(v2, dir, { recursive: true })
      const before = originals()
      upgrade()
      for (const name of names.filter((each) => each.endsWith('.json'))) {
        const { version, ...rest } = json(join(dir, name))
        expect(version).toBe(3)
        const { version: _, ...old } = JSON.parse(readFileSync(join(v2, name), 'utf8'))
        expect(rest).toEqual(old)
      }
      const lines = text(state('launches.jsonl')).split('\n')
      expect(lines[0]).toBe('{"version":3}')
      expect(lines.slice(1).join('\n')).toBe(before[3]!.split('\n').slice(1).join('\n'))
      expect(names.map((name) => text(join(dir, `${name}.v2.bak`)))).toEqual(before)
    })
  })

  it('gives an id to an entry of the current version added by hand and writes nothing else', () => {
    put(configFile, { version: SCHEMA_VERSION, projects: [{ id: 'id-abc', key: 'ABC', repo: 'C:\\abc' }, { key: 'NEW', repo: 'C:\\new' }] })
    upgrade()
    expect(json(configFile).projects[1]).toEqual({ id: 'guid-1', key: 'NEW', repo: 'C:\\new' })
    expect(logs).toEqual([`storage: gave an id to the projects of ${configFile} without one, the previous file is kept at ${configFile}.v${SCHEMA_VERSION}.bak`])
  })

  describe('writes nothing', () => {
    it('when any file is newer than the code', () => {
      putV1()
      put(state('account.json'), { version: SCHEMA_VERSION + 1, active: 'global', accounts: {}, removing: [] })
      const before = originals()
      expect(codeOf(upgrade)).toBe('storage.newer')
      expect(originals()).toEqual(before)
      expect(existsSync(`${configFile}.v1.bak`)).toBe(false)
    })

    it('when the launches log is newer than the code', () => {
      putV1()
      put(state('launches.jsonl'), `{"version":${SCHEMA_VERSION + 1}}\n`)
      expect(codeOf(upgrade)).toBe('storage.newer')
      expect(json(configFile)).toEqual(v1Config)
    })

    it('when a state file names a project the config does not have', () => {
      putV1()
      put(state('chain.json'), { ...v1Chain, queue: ['XYZ', 'OLD'] })
      const before = originals()
      expect(codeOf(upgrade)).toBe('storage.unknownProject')
      expect(originals()).toEqual(before)
    })

    it('when a launch names a project the config does not have', () => {
      putV1()
      put(state('launches.jsonl'), JSON.stringify({ ...v1Launches[0], project: 'OLD' }) + '\n')
      expect(codeOf(upgrade)).toBe('storage.unknownProject')
      expect(json(configFile)).toEqual(v1Config)
    })

    it('when a file is not JSON', () => {
      putV1()
      put(state('chain.json'), '{ "active": ')
      expect(codeOf(upgrade)).toBe('storage.damaged')
      expect(json(configFile)).toEqual(v1Config)
    })

    it('when the config is broken', () => {
      putV1()
      put(configFile, { projects: { 'not a key': 'C:\\abc' } })
      expect(codeOf(upgrade)).toBe('config.projectKey')
      expect(existsSync(state('chain.json.v1.bak'))).toBe(false)
    })
  })

  it('puts back the files it wrote when a write fails midway', () => {
    putV1()
    const before = originals()
    let writes = 0
    const failing = (file: string, body: string) => {
      if (++writes === 3) throw new Error('disk full')
      writeAtomic(file, body)
    }
    expect(codeOf(() => upgrade(failing))).toBe('storage.writeFailed')
    expect(originals()).toEqual(before)
  })
})
