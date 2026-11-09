import { describe, expect, it } from 'vitest'
import { BUILTIN } from '../../../src/builtin/model.js'
import { notice } from '../../../src/notice/notice.js'
import type { TrackerView } from '../../../src/tracker/health.js'
import { say, t } from '../i18n/index.js'
import { PROFILES } from './noticeFix.js'
import { unreadWhy } from './trackerDown.js'

const view = (over: Partial<TrackerView>): TrackerView => ({
  name: 'p-1',
  kind: 'gitlab',
  title: 'GitLab · example',
  projects: ['abc'],
  ready: false,
  health: { state: 'down', lastOkAt: null, error: 'call timed out after 15000 ms' },
  readAt: {},
  ...over,
})

describe('why a project is not read while its tracker is down (BTN-947)', () => {
  it('says what the error means, keeps the error for a tip and points at the profiles', () => {
    expect(unreadWhy(view({}))).toEqual({ why: t.statusPage.trackerProblem.timeout, detail: 'call timed out after 15000 ms', fix: PROFILES })
  })

  it("says the error's notice as it is, with the notice's own fix or the profiles", () => {
    const scope = notice('forgejo.scope', { scope: 'read:issue' })
    const health = { state: 'down' as const, lastOkAt: null, error: 'The Forgejo token lacks the read:issue scope.', notice: scope }
    expect(unreadWhy(view({ health }))).toEqual({ why: say(scope), detail: null, fix: PROFILES })
  })

  it('has no profile to send to for the built-in tracker', () => {
    expect(unreadWhy(view({ kind: BUILTIN, health: { state: 'down', lastOkAt: null, error: 'no database' } }))).toEqual({ why: t.system.lost, detail: null, fix: null })
  })

  it('has nothing to say about a tracker that is live, turned off or missing', () => {
    expect(unreadWhy(view({ health: { state: 'live', lastOkAt: null, error: null } }))).toBeNull()
    expect(unreadWhy(view({ health: { state: 'off', lastOkAt: null, error: null } }))).toBeNull()
    expect(unreadWhy(undefined)).toBeNull()
  })
})
