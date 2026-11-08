import { EditRefused, patchText, revisionOf, type TaskEditor } from '../tracker/editor.js'
import type { TaskPriority, TrackerTask } from '../tracker/model.js'
import { tracker } from './ids.js'
import { relabelHuly, type HulyLabelClient } from './labels.js'
import { fixCodeMarks, marksNote, type FixedMarks, type HulyMarkdown } from './marks.js'
import { hulyPriority, ISSUE_CLASS, namedStatus, toStatus, type HulyCardIssue, type HulyStatusDoc } from './model.js'

const ISSUE = tracker.class.Issue

/** A parent as an issue keeps it: the nearest first, up to the top. */
export interface HulyParent {
  parentId: string
  identifier: string
  parentTitle: string
  space: string
}

/** An issue read whole. */
export type HulyFullIssue = Omit<HulyCardIssue, 'parents'> & {
  space: string
  description?: string | null
  parents?: HulyParent[]
}

/** A new issue's fields, resolved to Huly's ids; the description is Markdown. */
export interface HulyNewIssue {
  title: string
  description: string
  status: string
  priority: TaskPriority
  milestone: string | null
  parent: HulyFullIssue | null
}

export interface HulyEditorClient extends HulyLabelClient {
  updateDoc(cls: string, space: string, id: string, update: Record<string, unknown>): Promise<unknown>
  fetchMarkup(cls: string, id: string, attribute: string, markup: string, format: 'markdown'): Promise<string>
  uploadMarkup(cls: string, id: string, attribute: string, markup: string, format: 'markdown'): Promise<string>
}

export interface HulyEditorDeps {
  client: HulyEditorClient
  markdown: HulyMarkdown
  /** Throws `TrackerNotFound` when there is no such issue. */
  findIssue(identifier: string): Promise<HulyFullIssue>
  /** The Huly project of Even Keel's project. */
  spaceOf(project: string): Promise<{ _id: string; identifier: string }>
  /** The workspace's statuses and the ids the project's type allows (`null` — any). */
  statusesOf(space: string): Promise<{ statuses: HulyStatusDoc[]; allowed: string[] | null }>
  /** Every issue of the Huly project. */
  issuesOf(space: string): Promise<TrackerTask[]>
  /** Creates the issue under its parent, or at the top, and returns its `_id` and identifier. */
  addIssue(space: { _id: string; identifier: string }, issue: HulyNewIssue): Promise<{ id: string; identifier: string }>
  comment(identifier: string, body: string): Promise<string>
}

/**
 * Huly's writes for the tasks MCP server (BTN-779). Huly has no revision of a description nor a write checked against
 * the value it replaces, so a short field is set whatever it holds, a patch is a read, `patchText` and a write with a
 * small window between them, and the revision is a hash of the description's Markdown (`revisionOf`). A parent is set
 * only on a new issue: moving an issue between parents rewrites its subtree in Huly, so these tools refuse it. Every
 * text is written with its code marks fixed (`fixCodeMarks`); a patch's `new` and appended section are fixed before
 * `patchText` too, so a repeated patch finds them as written and is "already so".
 */
export function hulyEditor(deps: HulyEditorDeps): TaskEditor {
  const { client, findIssue } = deps
  const fixer = () => {
    const fixes: FixedMarks[] = []
    return {
      fix(text: string): string {
        const fixed = fixCodeMarks(text, deps.markdown)
        fixes.push(fixed)
        return fixed.text
      },
      /** After the write: its note, if anything was fixed. */
      tell(notes: string[] | undefined): void {
        const note = marksNote(fixes)
        if (note !== null) notes?.push(note)
      },
    }
  }
  const markdownOf = async (issue: HulyFullIssue): Promise<string> =>
    issue.description ? client.fetchMarkup(ISSUE, issue._id, 'description', issue.description, 'markdown') : ''
  const writeDescription = async (issue: HulyFullIssue, text: string): Promise<void> => {
    const ref = await client.uploadMarkup(ISSUE, issue._id, 'description', text, 'markdown')
    await client.updateDoc(ISSUE, issue.space, issue._id, { description: ref })
  }
  const statusOf = async (space: string, name: string | null): Promise<HulyStatusDoc> => {
    const { statuses, allowed } = await deps.statusesOf(space)
    if (name !== null) {
      const found = namedStatus(name, statuses, allowed)
      if (found === null) throw new EditRefused(`there is no status "${name}" in the project`)
      return found
    }
    // A new task waits in the backlog until someone moves it, as on the built-in tracker.
    const byId = new Map(statuses.map((doc) => [doc._id, doc]))
    const candidates = allowed === null ? statuses : allowed.flatMap((id) => byId.get(id) ?? [])
    const backlog = candidates.find((doc) => toStatus(doc).category === 'UnStarted') ?? candidates[0]
    if (backlog === undefined) throw new EditRefused('the project has no statuses')
    return backlog
  }
  const milestoneOf = async (space: string, label: string): Promise<string> => {
    const found = await client.findOne<{ _id: string }>(tracker.class.Milestone, { space, label })
    if (found === undefined) throw new EditRefused(`there is no milestone "${label}" in the project`)
    return found._id
  }
  const related = (issue: HulyFullIssue, other: HulyFullIssue) => (issue.relations ?? []).some((ref) => ref._id === other._id)
  const relate = async (issue: HulyFullIssue, other: HulyFullIssue, on: boolean): Promise<void> => {
    if (related(issue, other) === on) return
    const update = on ? { $push: { relations: { _id: other._id, _class: ISSUE_CLASS } } } : { $pull: { relations: { _id: other._id } } }
    await client.updateDoc(ISSUE, issue.space, issue._id, update)
  }

  return {
    list: async (project) => deps.issuesOf((await deps.spaceOf(project))._id),
    async create(project, draft, notes) {
      const space = await deps.spaceOf(project)
      const marks = fixer()
      const parent = draft.parent === null ? null : await findIssue(draft.parent)
      if (parent !== null && parent.space !== space._id) throw new EditRefused(`the parent ${draft.parent} is of another project`)
      const [status, milestone] = await Promise.all([
        statusOf(space._id, draft.status),
        draft.milestone === null ? null : milestoneOf(space._id, draft.milestone),
      ])
      const created = await deps.addIssue(space, {
        title: draft.title,
        description: marks.fix(draft.description),
        status: status._id,
        priority: draft.priority ?? 'none',
        milestone,
        parent,
      })
      marks.tell(notes)
      if (draft.labels.length > 0) await relabelHuly(client, { _id: created.id, space: space._id }, { add: draft.labels, remove: [] })
      return created.identifier
    },
    async set(id, field) {
      const issue = await findIssue(id)
      const update = async (change: Record<string, unknown>) => {
        await client.updateDoc(ISSUE, issue.space, issue._id, change)
        return true
      }
      switch (field.field) {
        case 'title':
          return issue.title === field.to ? false : update({ title: field.to })
        case 'status': {
          const status = await statusOf(issue.space, field.to)
          return issue.status === status._id ? false : update({ status: status._id })
        }
        case 'priority': {
          const priority = hulyPriority(field.to)
          return (issue.priority ?? 0) === priority ? false : update({ priority })
        }
        case 'milestone': {
          if (field.to === null) return issue.milestone ? update({ milestone: null }) : false
          const milestone = await milestoneOf(issue.space, field.to)
          return issue.milestone === milestone ? false : update({ milestone })
        }
        case 'parent': {
          const current = issue.parents?.[0]?.identifier ?? null
          if (current?.toUpperCase() === field.to?.toUpperCase() || (current === null && field.to === null)) return false
          throw new EditRefused(`Huly: these tools set a parent only on a new task; move ${issue.identifier} under another parent in Huly itself`)
        }
      }
    },
    revision: async (id) => revisionOf(await markdownOf(await findIssue(id))),
    async describe(id, text, rev, notes) {
      const issue = await findIssue(id)
      const now = await markdownOf(issue)
      if (revisionOf(now) !== rev) {
        throw new EditRefused(`${issue.identifier}: the description was changed since rev ${rev} (now rev ${revisionOf(now)}); read it again, or patch it with "replace"`)
      }
      const marks = fixer()
      const next = marks.fix(text)
      if (lf(now).trim() === lf(next).trim()) return false
      await writeDescription(issue, next)
      marks.tell(notes)
      return true
    },
    async patch(id, patches, append, notes) {
      const issue = await findIssue(id)
      const marks = fixer()
      const fixedPatches = patches.map((each) => ({ old: each.old, new: marks.fix(each.new) }))
      const next = patchText(await markdownOf(issue), fixedPatches, append === null ? null : marks.fix(append))
      if (next === null) return false
      // A `new` that puts code inside a mark around it is fixed only in the whole text.
      await writeDescription(issue, marks.fix(next))
      marks.tell(notes)
      return true
    },
    async link(id, other, link, on) {
      const [issue, target] = await Promise.all([findIssue(id), findIssue(other)])
      if (issue._id === target._id) throw new EditRefused(`${issue.identifier} cannot be linked to itself`)
      if (link === 'relates') {
        await relate(issue, target, on)
        await relate(target, issue, on)
        return
      }
      const [blocker, blocked] = link === 'blocks' ? [issue, target] : [target, issue]
      if ((blocked.blockedBy ?? []).some((ref) => ref._id === blocker._id) === on) return
      const update = on ? { $push: { blockedBy: { _id: blocker._id, _class: ISSUE_CLASS } } } : { $pull: { blockedBy: { _id: blocker._id } } }
      await client.updateDoc(ISSUE, blocked.space, blocked._id, update)
    },
    relabel: async (id, change) => relabelHuly(client, await findIssue(id), change),
    // Huly's comment has no field for the session's model: the author is the account of Even Keel's profile.
    async comment(id, body, _model, notes) {
      const marks = fixer()
      const posted = await deps.comment(id, marks.fix(body))
      marks.tell(notes)
      return posted
    },
  }
}

/** The parents of a new issue under `parent`: the parent first, then its own. */
export function parentsUnder(parent: HulyFullIssue): HulyParent[] {
  return [{ parentId: parent._id, identifier: parent.identifier, parentTitle: parent.title, space: parent.space }, ...(parent.parents ?? [])]
}

function lf(text: string): string {
  return text.replace(/\r\n/g, '\n')
}
