import { megabytes } from '../notice/en.js'
import { englishOf, NoticeError } from '../notice/notice.js'
import { EditRefused, type TaskDraft, type TaskEditor, type TaskField, type TaskLink } from '../tracker/editor.js'
import { parseTaskId, runLabelOf, type TrackerTask } from '../tracker/model.js'
import type { Tracker, TrackerVocabulary } from '../tracker/source.js'
import type { TrackerCard } from '../tracker/card.js'
import { Args } from './args.js'

/** Where a call came from: the project of the server's address and, for a chain session, its task. */
export interface TasksScope {
  /** The project's id; `null` — an address without one (a session started by hand): each call names its project. */
  project: string | null
  task: string | null
}

export interface TasksDeps {
  /** Runs `call` on the project's tracker; throws when the tracker is off. */
  run<T>(project: string, call: (tracker: Tracker) => Promise<T>): Promise<T>
  /** The project of this key whose tracker the tools serve; `null` — none. */
  projectOfKey(key: string): string | null
  /** `<Provider> | <model>` of the live session of the project's task; `null` — not known. */
  modelOf(project: string, task: string): string | null
  /** The project's tasks changed: the chain reads them anew. */
  refresh(project: string): Promise<unknown>
}

const LIST_LIMIT = 200
const RETRIES_KEPT = 200
const LINKS: readonly TaskLink[] = ['blocks', 'blockedBy', 'relates']
const LINK_WORDS: Record<TaskLink, string> = { blocks: 'blocks', blockedBy: 'blocked by', relates: 'relates' }

/** What a batch of the retry key has created so far, by its place in the batch. */
interface Retry {
  ids: (string | undefined)[]
}

/**
 * The five tools over a tracker's `TaskEditor` (BTN-768): short Markdown answers, names instead of ids, no deletes.
 * Neutral to the tracker: everything goes through the `src/tracker/` layer.
 */
export class TasksTools {
  private readonly retries = new Map<string, Retry>()

  constructor(private readonly deps: TasksDeps) {}

  async call(name: string, raw: Record<string, unknown>, scope: TasksScope): Promise<string> {
    const args = new Args(raw)
    switch (name) {
      case 'tasks_list':
        return this.list(args, scope)
      case 'task_read':
        return this.read(args, scope)
      case 'tasks_create':
        return this.create(args, scope)
      case 'task_update':
        return this.update(args, scope)
      case 'task_comment':
        return this.comment(args, scope)
      default:
        throw new EditRefused(`there is no tool ${name}`)
    }
  }

  private async list(args: Args, scope: TasksScope): Promise<string> {
    const project = this.projectOf(args, scope)
    const statuses = args.texts('status').map((each) => each.trim().toLocaleLowerCase())
    const milestone = args.text('milestone')?.trim().toLocaleLowerCase()
    const label = args.text('label')?.trim().toLocaleLowerCase()
    const parent = args.text('parent')?.trim().toUpperCase()
    const words = args.text('text')?.trim().toLocaleLowerCase()
    const tasks = await this.deps.run(project, async (tracker) => editorOf(tracker).list(project))
    const found = tasks.filter((task) => {
      const status = task.status.name.toLocaleLowerCase()
      if (statuses.length === 0 ? task.status.category === 'Won' || task.status.category === 'Lost' : !statuses.includes('all') && !statuses.includes(status)) return false
      if (milestone !== undefined && task.milestone?.label.toLocaleLowerCase() !== milestone) return false
      if (label !== undefined && !task.labels.some((each) => each.toLocaleLowerCase() === label)) return false
      if (parent !== undefined && task.parent?.toUpperCase() !== parent) return false
      return words === undefined || task.title.toLocaleLowerCase().includes(words)
    })
    if (found.length === 0) return 'No tasks.'
    const lines = found.slice(0, LIST_LIMIT).map(listLine)
    if (found.length > LIST_LIMIT) lines.push(`… ${found.length - LIST_LIMIT} more; narrow the filter`)
    return lines.join('\n')
  }

  private async read(args: Args, scope: TasksScope): Promise<string> {
    const key = args.required('key').trim().toUpperCase()
    const project = this.projectOfTask(key, scope)
    const { card, rev } = await this.deps.run(project, async (tracker) => {
      const editor = editorOf(tracker)
      if (tracker.card === undefined) throw new EditRefused('this tracker gives no task cards')
      return { card: await tracker.card(key), rev: await editor.revision(key) }
    })
    return cardText(card, rev, args.flag('comments'))
  }

  private async create(args: Args, scope: TasksScope): Promise<string> {
    const project = this.projectOf(args, scope)
    const items = args.objects('tasks')
    const retryKey = args.text('retry')
    return this.deps.run(project, async (tracker) => {
      const editor = editorOf(tracker)
      const known = await vocabularyOf(tracker, project)
      const planned = items.map((item, index) => plannedTask(item, index, items.length, known))
      const retry = retryKey === undefined ? { ids: [] } : this.retryOf(`${project}\u0000${retryKey}`)
      const refOf = (ref: string) => (ref.startsWith('#') ? retry.ids[Number(ref.slice(1)) - 1]! : ref.toUpperCase())
      const done = () => planned.flatMap((each, index) => (retry.ids[index] === undefined ? [] : [`${retry.ids[index]} ${each.draft.title}`]))
      try {
        for (const [index, each] of planned.entries()) {
          if (retry.ids[index] !== undefined) continue
          try {
            retry.ids[index] = await editor.create(project, { ...each.draft, parent: each.draft.parent === null ? null : refOf(each.draft.parent) })
          } catch (error) {
            throw new EditRefused(`${createdSoFar(done())}task ${index + 1} was refused: ${refusalText(error)}. A repeat with the same retry creates only the rest`)
          }
        }
        for (const [index, each] of planned.entries()) {
          for (const link of LINKS) {
            for (const ref of each.links[link]) {
              try {
                await editor.link(retry.ids[index]!, refOf(ref), link, true)
              } catch (error) {
                throw new EditRefused(`${createdSoFar(done())}the link ${retry.ids[index]} ${LINK_WORDS[link]} ${refOf(ref)} was refused: ${refusalText(error)}. Fix the links with task_update`)
              }
            }
          }
        }
      } finally {
        await this.deps.refresh(project)
      }
      return done().join('\n')
    })
  }

  private async update(args: Args, scope: TasksScope): Promise<string> {
    const key = args.required('key').trim().toUpperCase()
    const project = this.projectOfTask(key, scope)
    const fields: TaskField[] = []
    const title = args.text('title')
    if (title !== undefined) fields.push({ field: 'title', to: title })
    const priority = args.priority('priority')
    if (priority !== undefined) fields.push({ field: 'priority', to: priority })
    const parent = args.nullable('parent')
    if (parent !== undefined) fields.push({ field: 'parent', to: parent === null ? null : parent.trim().toUpperCase() })
    const labels = args.change('labels')
    const links = Object.fromEntries(LINKS.map((link) => [link, args.change(link)])) as Record<TaskLink, { add: string[]; remove: string[] }>
    const patches = args.patches('replace')
    const append = args.text('append') ?? null
    const whole = args.text('description')
    const rev = args.integer('rev')
    if (whole !== undefined && (patches.length > 0 || append !== null)) throw new EditRefused('pass either "description" or "replace"/"append", not both')
    if (whole !== undefined && rev === undefined) throw new EditRefused('a whole "description" needs "rev", the description revision task_read shows; a patch with "replace" needs none')
    return this.deps.run(project, async (tracker) => {
      const editor = editorOf(tracker)
      const known = await vocabularyOf(tracker, project)
      const status = args.text('status')
      if (status !== undefined) fields.push({ field: 'status', to: statusName(status, known) })
      const milestone = args.nullable('milestone')
      if (milestone !== undefined) fields.push({ field: 'milestone', to: milestone === null ? null : milestoneName(milestone, known) })
      const add = labels.add.map((each) => labelName(each, known))
      const said: string[] = []
      try {
        if (whole !== undefined && (await editor.describe(key, whole, rev!))) said.push('description replaced')
        if ((patches.length > 0 || append !== null) && (await editor.patch(key, patches, append))) said.push('description patched')
        for (const field of fields) if (await editor.set(key, field)) said.push(fieldLine(field))
        if (add.length > 0 || labels.remove.length > 0) {
          const before = (await tracker.tasks([key]))[0]?.labels ?? []
          const after = await editor.relabel(key, { add, remove: labels.remove })
          const lower = (list: string[]) => new Set(list.map((each) => each.toLocaleLowerCase()))
          const [was, is] = [lower(before), lower(after)]
          const delta = [...after.filter((each) => !was.has(each.toLocaleLowerCase())).map((each) => `+${each}`), ...before.filter((each) => !is.has(each.toLocaleLowerCase())).map((each) => `−${each}`)]
          if (delta.length > 0) said.push(`labels ${delta.join(' ')}`)
        }
        for (const link of LINKS) {
          const { add: on, remove: off } = links[link]
          for (const other of off) await editor.link(key, other.trim().toUpperCase(), link, false)
          for (const other of on) await editor.link(key, other.trim().toUpperCase(), link, true)
          const delta = [...on.map((each) => `+${each.trim().toUpperCase()}`), ...off.map((each) => `−${each.trim().toUpperCase()}`)]
          if (delta.length > 0) said.push(`${LINK_WORDS[link]} ${delta.join(' ')}`)
        }
      } catch (error) {
        throw new EditRefused(`${said.length === 0 ? '' : `${key}: ${said.join('; ')}; then `}${refusalText(error)}`)
      } finally {
        if (said.length > 0) await this.deps.refresh(project)
      }
      return said.length === 0 ? `${key}: already so` : `${key}: ${said.join('; ')}`
    })
  }

  private async comment(args: Args, scope: TasksScope): Promise<string> {
    const key = args.required('key').trim().toUpperCase()
    const body = args.required('text')
    const project = this.projectOfTask(key, scope)
    const model = scope.task === null || scope.project === null ? null : this.deps.modelOf(scope.project, scope.task)
    await this.deps.run(project, async (tracker) => editorOf(tracker).comment(key, body, model))
    await this.deps.refresh(project)
    return `${key}: comment added`
  }

  private projectOf(args: Args, scope: TasksScope): string {
    if (scope.project !== null) return scope.project
    const key = args.text('project')?.trim().toUpperCase()
    if (key === undefined || key === '') throw new EditRefused('"project" is required: the key of the project, as in its task keys')
    const project = this.deps.projectOfKey(key)
    if (project === null) throw new EditRefused(`no project ${key} keeps its tasks where these tools reach`)
    return project
  }

  private projectOfTask(key: string, scope: TasksScope): string {
    if (scope.project !== null) return scope.project
    const parsed = parseTaskId(key.toUpperCase())
    if (parsed === null) throw new EditRefused(`"${key}" is not a task key such as ABC-12`)
    const project = this.deps.projectOfKey(parsed.project)
    if (project === null) throw new EditRefused(`no project ${parsed.project} keeps its tasks where these tools reach`)
    return project
  }

  private retryOf(key: string): Retry {
    const known = this.retries.get(key)
    if (known !== undefined) return known
    const fresh: Retry = { ids: [] }
    this.retries.set(key, fresh)
    if (this.retries.size > RETRIES_KEPT) this.retries.delete(this.retries.keys().next().value!)
    return fresh
  }
}

interface PlannedTask {
  draft: TaskDraft
  links: Record<TaskLink, string[]>
}

/** Checks every name and reference of a batch's task before anything is created. */
function plannedTask(item: Args, index: number, count: number, known: TrackerVocabulary): PlannedTask {
  const ref = (value: string, earlier: boolean): string => {
    const trimmed = value.trim()
    if (!trimmed.startsWith('#')) {
      if (parseTaskId(trimmed.toUpperCase()) === null) throw new EditRefused(`task ${index + 1}: "${trimmed}" is neither a task key nor #N`)
      return trimmed
    }
    const number = Number(trimmed.slice(1))
    if (!Number.isSafeInteger(number) || number < 1 || number > count) throw new EditRefused(`task ${index + 1}: ${trimmed} is not a task of this call (1…${count})`)
    if (number === index + 1) throw new EditRefused(`task ${index + 1}: ${trimmed} is the task itself`)
    if (earlier && number > index) throw new EditRefused(`task ${index + 1}: the parent ${trimmed} must come earlier in the call`)
    return trimmed
  }
  const status = item.text('status')
  const milestone = item.text('milestone')
  const parent = item.text('parent')
  return {
    draft: {
      title: item.required('title').trim(),
      description: item.text('description') ?? '',
      status: status === undefined ? null : statusName(status, known),
      priority: item.priority('priority') ?? null,
      milestone: milestone === undefined || milestone.trim() === '' ? null : milestoneName(milestone, known),
      labels: item.texts('labels').map((each) => labelName(each, known)),
      parent: parent === undefined || parent.trim() === '' ? null : ref(parent, true),
    },
    links: Object.fromEntries(LINKS.map((link) => [link, item.texts(link).map((each) => ref(each, false))])) as Record<TaskLink, string[]>,
  }
}

function editorOf(tracker: Tracker): TaskEditor {
  if (tracker.editor === undefined) throw new EditRefused("these tools do not serve this project's tracker; use the tracker's own MCP server")
  return tracker.editor
}

async function vocabularyOf(tracker: Tracker, project: string): Promise<TrackerVocabulary> {
  return (await tracker.vocabulary?.(project)) ?? { statuses: [], labels: [], milestones: [] }
}

function statusName(name: string, known: TrackerVocabulary): string {
  const found = known.statuses.find((each) => each.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())
  if (found === undefined) throw new EditRefused(`there is no status "${name}"; the statuses are ${known.statuses.map((each) => each.name).join(', ')}`)
  return found.name
}

function milestoneName(name: string, known: TrackerVocabulary): string {
  const list = known.milestones ?? []
  const found = list.find((each) => each.toLocaleLowerCase() === name.trim().toLocaleLowerCase())
  if (found === undefined) throw new EditRefused(`there is no milestone "${name}"; ${list.length === 0 ? 'the project has none' : `the milestones are ${list.join(', ')}`}. Only the user makes a new one`)
  return found
}

function labelName(name: string, known: TrackerVocabulary): string {
  const found = known.labels.find((each) => each.toLocaleLowerCase() === name.trim().toLocaleLowerCase())
  if (found !== undefined) return found
  if (runLabelOf(name) !== null) return name.trim()
  throw new EditRefused(`there is no label "${name}"; the labels are ${known.labels.join(', ')}. Only the user makes a new one`)
}

function fieldLine(field: TaskField): string {
  return `${field.field} → ${field.to ?? 'none'}`
}

function createdSoFar(lines: string[]): string {
  return lines.length === 0 ? 'Nothing was created: ' : `Created ${lines.join(', ')}; then `
}

function listLine(task: TrackerTask): string {
  return [task.id, task.status.name, ...(task.milestone === null ? [] : [task.milestone.label]), task.title].join(' · ')
}

/** The card as Markdown: a head of what the task has, then its description and, on request, its comments. */
export function cardText(card: TrackerCard, rev: number, comments: boolean): string {
  const refs = (list: { id: string }[]) => list.map((each) => each.id).join(', ')
  const head = [
    card.status.name,
    ...(card.priority === 'none' ? [] : [`priority ${card.priority}`]),
    ...(card.milestone === null ? [] : [`milestone ${card.milestone.label}`]),
    ...(card.labels.length === 0 ? [] : [`labels ${card.labels.join(', ')}`]),
    ...(card.parent === null ? [] : [`parent ${card.parent.id}`]),
    ...(card.blockedBy.length === 0 ? [] : [`blocked by ${refs(card.blockedBy)}`]),
    ...(card.blocks.length === 0 ? [] : [`blocks ${refs(card.blocks)}`]),
    ...(card.related.length === 0 ? [] : [`relates ${refs(card.related)}`]),
    `rev ${rev}`,
  ]
  const parts = [`# ${card.id} ${card.title}`, head.join(' · '), card.description.trim() === '' ? '(no description)' : card.description.trim()]
  const files = card.attachments.filter((each) => each.path !== undefined)
  if (files.length > 0) {
    const lines = files.map((each) => `- ${each.name} (${sizeText(each.size)}) — ${each.missing ? 'file missing' : each.path}`)
    parts.push(`## Attachments\n\n${lines.join('\n')}`)
  }
  if (comments) {
    const list = card.comments.map((each) => {
      const who = each.author ?? 'Person'
      const model = each.journal?.model == null ? '' : ` (${each.journal.model})`
      return `### ${who}${model}, ${new Date(each.at).toISOString().slice(0, 16).replace('T', ' ')}\n\n${each.text.trim()}`
    })
    parts.push(list.length === 0 ? '## Comments\n\nnone' : `## Comments\n\n${list.join('\n\n')}`)
  }
  return parts.join('\n\n')
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${megabytes(bytes)} MB`
}

/** The reason of a failed write in a line for the agent. */
export function refusalText(error: unknown): string {
  if (error instanceof EditRefused) return error.message
  if (error instanceof NoticeError) return englishOf(error.notice)
  return error instanceof Error ? error.message : String(error)
}
