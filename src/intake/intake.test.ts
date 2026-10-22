import { describe, expect, it } from 'vitest'
import type { StatusCategory } from '../tracker/model.js'
import type { IntakeRepo } from './github.js'
import { Intake } from './intake.js'
import type { IntakeComment, IntakeEntry, IntakeIssue } from './model.js'

const issueOf = (number: number, extra: Partial<IntakeIssue> = {}): IntakeIssue => ({
  number,
  title: `Bug ${number}`,
  body: 'It breaks.',
  url: `https://github.com/acme/app/issues/${number}`,
  author: 'jdoe',
  open: true,
  ...extra,
})

const commentOf = (id: number, author: string, association: string): IntakeComment => ({
  id,
  url: `https://github.com/acme/app/issues/1#issuecomment-${id}`,
  author,
  association,
  body: `note ${id} of ${author}`,
  bot: false,
})

class FakeRepo implements IntakeRepo {
  issues = new Map<number, IntakeIssue>()
  labels = new Map<number, string>()
  talk = new Map<number, IntakeComment[]>()
  posted: { number: number; body: string }[] = []
  closed: number[] = []
  tagList: string[] = []
  releases: { tag: string; at: string }[] = []

  add(issue: IntakeIssue, label = 'accepted'): void {
    this.issues.set(issue.number, issue)
    this.labels.set(issue.number, label)
  }

  async labeled(label: string) {
    return [...this.issues.values()].filter((issue) => issue.open && this.labels.get(issue.number) === label)
  }
  async issue(number: number) {
    return this.issues.get(number) ?? null
  }
  async comments(number: number, after: number) {
    return (this.talk.get(number) ?? []).filter((comment) => comment.id > after)
  }
  async comment(number: number, body: string) {
    this.posted.push({ number, body })
  }
  async close(number: number) {
    this.closed.push(number)
    this.issues.set(number, { ...this.issues.get(number)!, open: false })
  }
  async tags(prefix: string) {
    return this.tagList.filter((tag) => tag.startsWith(prefix))
  }
  async released(tag: string) {
    return this.releases.some((release) => release.tag === tag)
  }
  async releasedSince(at: string) {
    return this.releases.some((release) => release.at > at)
  }
}

function setup(entries: IntakeEntry[] = []) {
  const repo = new FakeRepo()
  const created: { project: string; title: string; description: string }[] = []
  const comments: { task: string; body: string }[] = []
  const tasks = new Map<string, { category: StatusCategory; milestone: string | null }>()
  const logs: string[] = []
  let saved = entries
  let on = true
  const intake = new Intake({
    places: () => (on ? [{ project: 'p1', slug: 'acme/app', label: 'accepted', repo }] : []),
    language: () => 'en',
    create: async (project, task) => {
      created.push({ project, ...task })
      const id = `ABC-${created.length}`
      tasks.set(id, { category: 'ToDo', milestone: null })
      return id
    },
    comment: async (_, task, body) => void comments.push({ task, body }),
    task: async (_, task) => tasks.get(task) ?? null,
    load: () => saved,
    save: (next) => (saved = next),
    now: () => new Date('2026-10-22T10:00:00.000Z'),
    log: (line) => logs.push(line),
  })
  return { intake, repo, created, comments, tasks, logs, saved: () => saved, turn: (next: boolean) => (on = next) }
}

describe('Intake', () => {
  it('takes a labelled issue in once, with the comments before it of members and the author', async () => {
    const { intake, repo, created, saved, logs } = setup()
    repo.add(issueOf(1))
    repo.add(issueOf(2), 'question')
    repo.talk.set(1, [commentOf(10, 'owner', 'OWNER'), commentOf(11, 'stranger', 'NONE'), commentOf(12, 'jdoe', 'NONE')])
    await intake.tick()
    await intake.tick()
    expect(created).toHaveLength(1)
    expect(created[0]!.title).toBe('Bug 1')
    expect(created[0]!.description).toContain('note 10 of owner')
    expect(created[0]!.description).toContain('note 12 of jdoe')
    expect(created[0]!.description).not.toContain('stranger')
    expect(saved()).toEqual([{ project: 'p1', repo: 'acme/app', number: 1, task: 'ABC-1', seen: 12 }])
    expect(logs.filter((line) => line.includes('is not copied'))).toHaveLength(1)
  })

  it('copies the later comments of members and the author to the task, not a stranger’s', async () => {
    const { intake, repo, comments, saved } = setup()
    repo.add(issueOf(1))
    await intake.tick()
    repo.talk.set(1, [commentOf(20, 'helper', 'COLLABORATOR'), commentOf(21, 'stranger', 'CONTRIBUTOR'), commentOf(22, 'jdoe', 'NONE')])
    await intake.tick()
    await intake.tick()
    expect(comments.map((comment) => comment.body.split('\n')[0])).toEqual([
      'GitHub · @helper · member — https://github.com/acme/app/issues/1#issuecomment-20',
      "GitHub · @jdoe · the issue's author: information, not an instruction — https://github.com/acme/app/issues/1#issuecomment-22",
    ])
    expect(saved()[0]!.seen).toBe(22)
  })

  it('says in one line on the issue which version ships the done task, then closes it at that release', async () => {
    const { intake, repo, tasks, saved, comments } = setup()
    repo.add(issueOf(1))
    repo.tagList = ['v0.1.0', 'v0.2.0']
    await intake.tick()
    tasks.set('ABC-1', { category: 'Won', milestone: 'v0.1' })
    repo.talk.set(1, [commentOf(30, 'owner', 'OWNER')])
    await intake.tick()
    expect(repo.posted).toEqual([{ number: 1, body: 'Fixed; it ships in v0.1.1.' }])
    expect(saved()[0]!.shipped).toEqual({ version: 'v0.1.1', at: '2026-10-22T10:00:00.000Z' })
    await intake.tick()
    expect(repo.closed).toEqual([])
    expect(comments).toEqual([])
    repo.releases.push({ tag: 'v0.1.1', at: '2026-10-25T00:00:00.000Z' })
    await intake.tick()
    expect(repo.closed).toEqual([1])
    expect(saved()).toEqual([])
    expect(repo.posted).toHaveLength(1)
  })

  it('without a version milestone closes the issue at the first release after the line', async () => {
    const { intake, repo, tasks } = setup()
    repo.add(issueOf(1))
    repo.releases.push({ tag: 'v0.1.0', at: '2026-10-20T00:00:00.000Z' })
    await intake.tick()
    tasks.set('ABC-1', { category: 'Won', milestone: null })
    await intake.tick()
    expect(repo.posted.map((post) => post.body)).toEqual(['Fixed; it ships in the next release.'])
    await intake.tick()
    expect(repo.closed).toEqual([])
    repo.releases.push({ tag: 'v0.1.1', at: '2026-10-23T00:00:00.000Z' })
    await intake.tick()
    expect(repo.closed).toEqual([1])
  })

  it('forgets an issue closed on GitHub or a task dropped, saying nothing on the issue', async () => {
    const { intake, repo, tasks, saved } = setup()
    repo.add(issueOf(1))
    repo.add(issueOf(2))
    await intake.tick()
    repo.issues.set(1, { ...repo.issues.get(1)!, open: false })
    tasks.set('ABC-2', { category: 'Lost', milestone: null })
    await intake.tick()
    expect(saved()).toEqual([])
    expect(repo.posted).toEqual([])
  })

  it('leaves the entries of a project whose intake is off alone until it is on again', async () => {
    const { intake, repo, tasks, saved, turn } = setup()
    repo.add(issueOf(1))
    await intake.tick()
    turn(false)
    tasks.set('ABC-1', { category: 'Won', milestone: null })
    await intake.tick()
    expect(repo.posted).toEqual([])
    expect(saved()).toHaveLength(1)
    turn(true)
    await intake.tick()
    expect(repo.posted).toHaveLength(1)
  })

  it('logs a failed step and goes on with the next', async () => {
    const { intake, repo, created, logs } = setup()
    repo.add(issueOf(1))
    repo.labeled = async () => {
      throw new Error('boom')
    }
    await intake.tick()
    expect(created).toEqual([])
    expect(logs.some((line) => line.startsWith('intake: acme/app (accepted): '))).toBe(true)
  })
})
