import { describe, expect, it } from 'vitest'
import { folderGroups, isTaskId, OTHER_GROUP, parsePeriodQuery, parseStatsFilter, readerSettings, repoTail, SCRATCH_GROUP } from './model.js'

describe('parseStatsFilter', () => {
  it('defaults to every session of every account in UTC', () => {
    expect(parseStatsFilter(new URLSearchParams())).toEqual({ scope: 'all', account: null, tz: 'UTC' })
  })

  it('takes the chain scope, an account and a time zone', () => {
    expect(parseStatsFilter(new URLSearchParams('scope=chain&account=work&tz=America/Argentina/Buenos_Aires'))).toEqual({
      scope: 'chain',
      account: 'work',
      tz: 'America/Argentina/Buenos_Aires',
    })
  })

  it('rejects an unknown scope and a zone that is not a name', () => {
    expect(() => parseStatsFilter(new URLSearchParams('scope=mine'))).toThrow(/scope/)
    expect(() => parseStatsFilter(new URLSearchParams("tz=UTC';"))).toThrow(/tz/)
  })
})

describe('parsePeriodQuery', () => {
  it('reads both days and the projects', () => {
    expect(parsePeriodQuery(new URLSearchParams('from=2026-09-04&to=2026-10-03&projects=ABC,Example'))).toMatchObject({
      from: '2026-09-04',
      to: '2026-10-03',
      projects: ['ABC', 'Example'],
    })
  })

  it('treats missing projects as all and an empty list as none', () => {
    expect(parsePeriodQuery(new URLSearchParams('from=2026-10-03&to=2026-10-03')).projects).toBeNull()
    expect(parsePeriodQuery(new URLSearchParams('from=2026-10-03&to=2026-10-03&projects=')).projects).toEqual([])
  })

  it('rejects missing, impossible and reversed days', () => {
    expect(() => parsePeriodQuery(new URLSearchParams('from=2026-10-03'))).toThrow(/from and to/)
    expect(() => parsePeriodQuery(new URLSearchParams('from=2026-02-30&to=2026-03-01'))).toThrow(/from and to/)
    expect(() => parsePeriodQuery(new URLSearchParams('from=2026-10-03&to=2026-10-01'))).toThrow(/after/)
  })
})

describe('isTaskId', () => {
  it('accepts a tracker key and rejects anything else', () => {
    expect(isTaskId('ABC-12')).toBe(true)
    expect(isTaskId('abc-12')).toBe(false)
    expect(isTaskId("ABC-1'")).toBe(false)
  })
})

describe('repoTail', () => {
  it('drops the drive, lowercases and uses forward slashes', () => {
    expect(repoTail('C:\\Projects\\Example')).toBe('/projects/example')
    expect(repoTail('d:/Projects/Example/')).toBe('/projects/example')
  })

  it('keeps a path without a drive', () => {
    expect(repoTail('/home/john/example')).toBe('/home/john/example')
  })
})

describe('folderGroups', () => {
  const folder = (raw: string, cost = 100) => ({ dir: repoTail(raw), raw, cost })
  const example = [{ key: 'EX', dir: '/work/git/example' }]

  it('puts a folder under the outermost seen folder that holds it, named as written', () => {
    const groups = folderGroups([folder('D:\\Work\\Tools\\forge\\backups'), folder('D:\\Work\\Tools'), folder('D:\\Work\\Tools\\forge')], [])
    expect([...groups.values()]).toEqual(['Tools', 'Tools', 'Tools'])
  })

  it('keeps a folder whose parent was never seen on its own', () => {
    expect(folderGroups([folder('D:\\Work\\relay\\systemd')], []).get('/work/relay/systemd')).toBe('systemd')
  })

  it('never groups under a one-level folder or a folder holding an Even Keel project', () => {
    const groups = folderGroups([folder('D:\\Work'), folder('D:\\Work\\alpha'), folder('D:\\Work\\git'), folder('D:\\Work\\git\\side')], example)
    expect(Object.fromEntries(groups)).toEqual({ '/work': 'Work', '/work/alpha': 'alpha', '/work/git': 'git', '/work/git/side': 'side' })
  })

  it('folds the scratch folders of the desktop app into one group', () => {
    const scratch = 'C:\\Users\\John\\AppData\\Roaming\\Claude\\scratch-workspaces\\a1\\b2\\scratch-2026-09-20-abc123'
    expect(folderGroups([folder(scratch)], []).get(repoTail(scratch))).toBe(SCRATCH_GROUP)
  })

  it('names a group by its last segment even with a trailing slash', () => {
    expect(folderGroups([folder('D:/Work/Example/')], []).get('/work/example')).toBe('Example')
  })

  it('gives the folders of an Even Keel project and of its old sibling worktrees its key', () => {
    const groups = folderGroups(
      [folder('D:\\Work\\git\\example'), folder('D:\\Work\\git\\example\\src'), folder('D:\\Work\\git\\Example-ex12'), folder('D:\\Work\\git\\example-ex-3\\docs')],
      example,
    )
    expect([...groups.values()]).toEqual(['EX', 'EX', 'EX', 'EX'])
  })

  it('keeps a sibling folder that is not a worktree name on its own', () => {
    expect(folderGroups([folder('D:\\Work\\git\\example-server')], example).get('/work/git/example-server')).toBe('example-server')
  })

  it('reads a moved folder, its subfolders and sibling worktrees as the new place', () => {
    const moves = { 'D:/Old/Tool': 'E:/Work/git/example', 'D:/Old/Infra': 'D:/Admin' }
    const groups = folderGroups(
      [folder('D:\\Old\\Tool'), folder('D:\\Old\\Tool-ex-7\\.temp'), folder('D:\\Old\\Infra'), folder('D:\\Old\\Infra\\nginx'), folder('D:\\Admin\\backups')],
      example,
      moves,
    )
    expect(Object.fromEntries(groups)).toEqual({
      '/old/tool': 'EX',
      '/old/tool-ex-7/.temp': 'EX',
      '/old/infra': 'Admin',
      '/old/infra/nginx': 'Admin',
      '/admin/backups': 'Admin',
    })
  })

  it('folds groups that cost less than the threshold in all, but never an Even Keel project', () => {
    const groups = folderGroups(
      [folder('D:\\Work\\Big', 60), folder('D:\\Docs\\notes', 20), folder('D:\\Docs\\notes\\a', 20), folder('D:\\Work\\tiny', 5), folder('D:\\Work\\git\\example', 1)],
      example,
      {},
      50,
    )
    expect(Object.fromEntries(groups)).toEqual({
      '/work/big': 'Big',
      '/docs/notes': OTHER_GROUP,
      '/docs/notes/a': OTHER_GROUP,
      '/work/tiny': OTHER_GROUP,
      '/work/git/example': 'EX',
    })
  })
})

describe('readerSettings', () => {
  const env = { TALLY_DB_HOST: 'db.example.com', TALLY_DB_NAME: 'tally', TALLY_READER_PASSWORD: 'secret' }

  it('reads the reader role from the environment', () => {
    expect(readerSettings(env)).toEqual({
      host: 'db.example.com',
      port: 5432,
      database: 'tally',
      user: 'tally_reader',
      password: 'secret',
      options: '-c jit=off',
    })
  })

  it('takes a port and another user name', () => {
    expect(readerSettings({ ...env, TALLY_DB_PORT: '6543', TALLY_READER_USER: 'viewer' })).toMatchObject({ port: 6543, user: 'viewer' })
  })

  it('names what is missing, the host too', () => {
    expect(readerSettings({ TALLY_DB_HOST: 'db.example.com' })).toBe('TALLY_DB_NAME, TALLY_READER_PASSWORD')
    expect(readerSettings({ TALLY_READER_PASSWORD: 'secret' })).toBe('TALLY_DB_HOST, TALLY_DB_NAME')
  })
})
