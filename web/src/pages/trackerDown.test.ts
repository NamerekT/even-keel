import { describe, expect, it } from 'vitest'
import { BUILTIN } from '../../../src/builtin/model.js'
import { notice } from '../../../src/notice/notice.js'
import type { TrackerView } from '../../../src/tracker/health.js'
import { say, t } from '../i18n/index.js'
import { PROFILES } from './noticeFix.js'
import { type FeedsState, feedsUnread, termsRefused, unreadWhy } from './trackerDown.js'

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

describe("why a project's feeds are not read while their tracker is down (BTN-1210)", () => {
  const live = { state: 'live' as const, lastOkAt: null, error: null }
  const scope = notice('forgejo.scope', { scope: 'read:issue' })
  const down = { state: 'down' as const, lastOkAt: null, error: 'The Forgejo token lacks the read:issue scope.', notice: scope }
  const state = (trackers: TrackerView[], feeds: { id: string; key: string }[]): FeedsState => ({
    trackers,
    config: { feeds: { abc: feeds } } as unknown as FeedsState['config'],
  })

  it('names the feeds of each down tracker with why and the fix', () => {
    const own = view({ name: 'p-1', projects: ['abc'], health: live })
    const forge = view({ name: 'p-2', kind: 'forgejo', projects: ['f-1', 'f-2'], health: down })
    const feeds = [{ id: 'f-1', key: 'FSC' }, { id: 'f-2', key: 'FSD' }]
    expect(feedsUnread(state([own, forge], feeds), 'abc')).toEqual([{ feeds: ['FSC', 'FSD'], unread: { why: say(scope), detail: null, fix: PROFILES } }])
  })

  it("leaves out a feed on the project's own tracker: its line already says it", () => {
    const own = view({ name: 'p-1', projects: ['abc', 'f-1'] })
    expect(feedsUnread(state([own], [{ id: 'f-1', key: 'FSC' }]), 'abc')).toEqual([])
  })

  it("names the project and the feeds whose vocabulary is refused while their tasks are read, one entry a reason (EKR-106)", () => {
    const org = notice('forgejo.scope', { scope: 'read:organization' })
    const own = view({ name: 'p-1', kind: 'forgejo', projects: ['abc', 'f-1'], health: live, termsRefused: { abc: org, 'f-1': org } })
    const forge = view({ name: 'p-2', kind: 'forgejo', projects: ['f-2', 'f-3'], health: live, termsRefused: { 'f-2': scope } })
    const feeds = [{ id: 'f-1', key: 'FSC' }, { id: 'f-2', key: 'FSD' }, { id: 'f-3', key: 'FSE' }]
    expect(termsRefused({ ...state([own, forge], feeds), projectKeys: { abc: 'ABC' } }, 'abc')).toEqual([
      { keys: ['ABC', 'FSC'], why: say(org), fix: PROFILES },
      { keys: ['FSD'], why: say(scope), fix: PROFILES },
    ])
    expect(termsRefused({ ...state([own], feeds), projectKeys: {} }, 'xyz')).toEqual([])
  })

  it('has nothing to say about feeds whose tracker is live or missing, or a project without feeds', () => {
    const own = view({ name: 'p-1', projects: ['abc'], health: live })
    const forge = view({ name: 'p-2', projects: ['f-1'], health: live })
    expect(feedsUnread(state([own, forge], [{ id: 'f-1', key: 'FSC' }, { id: 'f-9', key: 'GONE' }]), 'abc')).toEqual([])
    expect(feedsUnread(state([own], []), 'xyz')).toEqual([])
  })
})
