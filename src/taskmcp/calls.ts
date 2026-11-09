import { megabytes } from '../notice/en.js'
import { englishOf, NoticeError } from '../notice/notice.js'
import type { Queryable } from '../storage/database.js'
import { EditRefused, type TaskDraft, type TaskEditor, type TaskField, type TaskFiles, type TaskLink } from '../tracker/editor.js'
import { parseTaskId, runLabelOf, type TrackerTask } from '../tracker/model.js'
import type { Tracker } from '../tracker/source.js'
import type { TaskComment, TrackerCard } from '../tracker/card.js'
import { sameName, type ChainRules } from '../chain/rules.js'
import { Args } from './args.js'
import { TaskRetries, unsavedRetry, type Retry } from './retries.js'
import { rolesLine, termsOf, vocabularyFor, type TrackerTerms } from './vocabulary.js'
import { readUploads } from './files.js'
import type { ToolFields } from './tools.js'

/** Where a call came from: the project of the server's address and, for a chain session, its task. */
export interface TasksScope {
  /** The project's id; `null` — an address without one (a session started by hand): each call names its project. */
  project: string | null
  task: string | null
}

/** A tracker of a project the tools serve (BTN-892): the project's own or one of its feeds. */
export interface TaskReader {
  /** What the tracker layer reads it by: the project's GUID or the feed's. */
  id: string
  /** The project it belongs to. */
  project: string
  /** The prefix of its task keys, in upper case. */
  prefix: string
}

export interface TasksDeps {
  db: Queryable
  /** Runs `call` on the reader's tracker; throws when the tracker is off. */
  run<T>(reader: string, call: (tracker: Tracker) => Promise<T>): Promise<T>
  /** The project's trackers, its own first, then its feeds. */
  readers(project: string): TaskReader[]
  /** The tracker the tools serve whose task keys carry this prefix, a project's or a feed's; `null` — none. */
  readerOfPrefix(prefix: string): TaskReader | null
  /** The chain rules the reader's tasks are judged by: the project's, or a feed's own (`feedRules`). */
  rulesOf(reader: string): ChainRules
  /** `<Provider> | <model>` of the live session of the project's task; `null` — not known. */
  modelOf(project: string, task: string): string | null
  /** The project's tasks changed: the chain reads them anew. */
  refresh(project: string): Promise<unknown>
  /**
   * The folder whose files the session may attach (BTN-895): a chain session's worktree, otherwise the repository of
   * `project`; `null` — not known, nothing is attached.
   */
  folderOf(scope: TasksScope, project: string): string | null
  /** The attachment size limit, bytes, read per call: the setting is live. */
  attachmentLimit(): number
}

const LIST_LIMIT = 200
const LINKS: readonly TaskLink[] = ['blocks', 'blockedBy', 'relates']
const LINK_WORDS: Record<TaskLink, string> = { blocks: 'blocks', blockedBy: 'blocked by', relates: 'relates' }

/**
 * The five tools over a tracker's `TaskEditor` (BTN-768): short Markdown answers, names instead of ids, no deletes.
 * Neutral to the tracker: everything goes through the `src/tracker/` layer.
 */
export class TasksTools {
  private readonly retries: TaskRetries

  constructor(private readonly deps: TasksDeps) {
    this.retries = new TaskRetries(deps.db)
  }

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

  /**
   * The fields of a session's tools (BTN-895): a component where a tracker of its project keeps components, files where
   * one takes them. A session without a project names one per call: it gets both.
   */
  async fields(scope: TasksScope): Promise<ToolFields> {
    if (scope.project === null) return { components: true, attachments: true }
    const kept = await Promise.all(
      this.deps.readers(scope.project).map((reader) =>
        this.deps.run(reader.id, async (tracker) => ({ components: tracker.editor?.components === true, attachments: tracker.editor?.files !== undefined })).catch(() => null),
      ),
    )
    return { components: kept.some((each) => each?.components === true), attachments: kept.some((each) => each?.attachments === true) }
  }

  private async list(args: Args, scope: TasksScope): Promise<string> {
    const { readers } = this.projectOf(args, scope)
    const statuses = args.texts('status').map((each) => each.trim().toLocaleLowerCase())
    const milestone = args.text('milestone')?.trim().toLocaleLowerCase()
    const label = args.text('label')?.trim().toLocaleLowerCase()
    const parent = args.text('parent')?.trim().toUpperCase()
    const words = args.text('text')?.trim().toLocaleLowerCase()
    const named = trackerArg(args, readers)
    const searched = named === null ? readers : [named]
    // One tracker down must not fail the rest; a quietly short list would lead to duplicates, so it is named.
    const answers = await Promise.allSettled(searched.map((reader) => this.deps.run(reader.id, async (tracker) => editorOf(tracker).list(reader.id))))
    const tasks = answers.flatMap((answer) => (answer.status === 'fulfilled' ? answer.value : []))
    const missed = answers.flatMap((answer, index) => (answer.status === 'rejected' ? [`${searched[index]!.prefix}: unreachable, not searched (${refusalText(answer.reason)})`] : []))
    if (searched.length === 1 && missed.length > 0) throw (answers[0] as PromiseRejectedResult).reason
    const found = tasks.filter((task) => {
      const status = task.status.name.toLocaleLowerCase()
      if (statuses.length === 0 ? task.status.category === 'Won' || task.status.category === 'Lost' : !statuses.includes('all') && !statuses.includes(status)) return false
      if (milestone !== undefined && task.milestone?.label.toLocaleLowerCase() !== milestone) return false
      if (label !== undefined && !task.labels.some((each) => each.toLocaleLowerCase() === label)) return false
      if (parent !== undefined && task.parent?.toUpperCase() !== parent) return false
      return words === undefined || task.title.toLocaleLowerCase().includes(words)
    })
    const lines = found.length === 0 ? ['No tasks.'] : found.slice(0, LIST_LIMIT).map(listLine)
    if (found.length > LIST_LIMIT) lines.push(`… ${found.length - LIST_LIMIT} more; narrow the filter`)
    return [...lines, ...missed].join('\n')
  }

  private async read(args: Args, scope: TasksScope): Promise<string> {
    const key = args.required('key').trim().toUpperCase()
    const reader = this.readerOfTask(key, scope)
    const { card, rev, terms } = await this.deps.run(reader.id, async (tracker) => {
      const editor = editorOf(tracker)
      if (tracker.card === undefined) throw new EditRefused('this tracker gives no task cards')
      // The roles line helps, the card is the answer: a vocabulary that did not read only leaves the line out.
      const [card, rev, terms] = await Promise.all([tracker.card(key), editor.revision(key), this.termsOf(tracker, reader.id).catch(() => null)])
      return { card, rev, terms }
    })
    return cardText(card, rev, args.flag('comments'), terms === null ? null : rolesLine(terms))
  }

  private async create(args: Args, scope: TasksScope): Promise<string> {
    const { readers, named } = this.projectOf(args, scope)
    // A blocker lives with the task it holds: by default the tracker of the session's task.
    const own = scope.task === null ? undefined : readers.find((each) => each.prefix === parseTaskId(scope.task!.toUpperCase())?.project)
    const reader = trackerArg(args, readers) ?? named ?? own ?? readers[0]!
    const project = reader.id
    const items = args.objects('tasks')
    const retryKey = args.text('retry')
    return this.deps.run(project, async (tracker) => {
      const editor = editorOf(tracker)
      const terms = await this.termsOf(tracker, project)
      const planned = items.map((item, index) => plannedTask(item, index, items.length, terms, reader.prefix))
      // Every file is read before anything is created: a refused path refuses the whole batch.
      const uploads = await Promise.all(
        planned.map((each) => (each.attach.length === 0 ? [] : this.uploads(each.attach, scope, reader))),
      )
      const run = async (retry: Retry): Promise<string> => {
        const refOf = (ref: string) => (ref.startsWith('#') ? retry.ids[Number(ref.slice(1)) - 1]! : ref.toUpperCase())
        const notes = planned.map((): string[] => [])
        const noted = (index: number) => (notes[index]!.length === 0 ? '' : ` (${notes[index]!.join('; ')})`)
        const done = () => planned.flatMap((each, index) => (retry.ids[index] === undefined ? [] : [`${retry.ids[index]} ${each.draft.title}${noted(index)}`]))
        try {
          for (const [index, each] of planned.entries()) {
            if (retry.ids[index] !== undefined) continue
            const draft = { ...each.draft, parent: each.draft.parent === null ? null : refOf(each.draft.parent) }
            const started = retry.started?.at === index ? retry.started.marker : undefined
            const marker = started ?? editor.markers?.make()
            if (marker !== undefined && started === undefined) {
              try {
                await retry.start(index, marker)
              } catch (error) {
                throw new EditRefused(`${createdSoFar(done())}retry progress was not saved before task ${index + 1}: ${refusalText(error)}. A repeat with the same retry creates the rest`)
              }
            }
            let fresh = false
            try {
              const found = started === undefined || editor.markers === undefined ? null : await editor.markers.find(project, started)
              if (found === null) {
                retry.ids[index] = await editor.create(project, draft, notes[index], marker)
                fresh = true
              } else {
                // Labels go on after the create on some trackers: a crash between the two left none.
                if (draft.labels.length > 0) await editor.relabel(found, { add: draft.labels, remove: [] })
                notes[index]!.push('found in the tracker after an interrupted call')
                retry.ids[index] = found
              }
            } catch (error) {
              throw new EditRefused(`${createdSoFar(done())}task ${index + 1} was refused: ${refusalText(error)}. A repeat with the same retry creates only the rest`)
            }
            try {
              await retry.save()
            } catch (error) {
              const after = marker === undefined ? 'Check the created tasks in the tracker before repeating; an unsaved task may be duplicated' : 'A repeat with the same retry finds the unsaved task in the tracker by its marker'
              throw new EditRefused(`${createdSoFar(done())}retry progress was not saved: ${refusalText(error)}. ${after}`)
            }
            // After the save: a repeat skips the task, so its files are never attached twice.
            const files = uploads[index]!
            if (fresh && files.length > 0) {
              try {
                await editor.files!.attach(retry.ids[index]!, files, notes[index])
                notes[index]!.push(`attached ${files.map((file) => file.name).join(', ')}`)
              } catch (error) {
                throw new EditRefused(`${createdSoFar(done())}the files of ${retry.ids[index]} were refused: ${refusalText(error)}. Attach them with task_update`)
              }
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
          await this.deps.refresh(reader.project)
        }
        return done().join('\n')
      }
      return retryKey === undefined ? run(unsavedRetry()) : this.retries.run(project, retryKey, run)
    })
  }

  private async update(args: Args, scope: TasksScope): Promise<string> {
    const key = args.required('key').trim().toUpperCase()
    const reader = this.readerOfTask(key, scope)
    const project = reader.id
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
    const estimate = estimateArg(args)
    const component = args.nullable('component')
    const attach = args.texts('attach')
    if (whole !== undefined && (patches.length > 0 || append !== null)) throw new EditRefused('pass either "description" or "replace"/"append", not both')
    if (whole !== undefined && rev === undefined) throw new EditRefused('a whole "description" needs "rev", the description revision task_read shows; a patch with "replace" needs none')
    const others = [...(parent === undefined || parent === null ? [] : [parent]), ...LINKS.flatMap((link) => [...links[link].add, ...links[link].remove])]
    const foreign = others.map((each) => each.trim().toUpperCase()).find((each) => crossesTrackers(each, reader.prefix))
    if (foreign !== undefined) throw new EditRefused(crossRefusal(foreign))
    return this.deps.run(project, async (tracker) => {
      const editor = editorOf(tracker)
      const terms = await this.termsOf(tracker, project)
      const status = args.text('status')
      if (status !== undefined) fields.push({ field: 'status', to: statusName(status, terms) })
      const milestone = args.nullable('milestone')
      if (milestone !== undefined) fields.push({ field: 'milestone', to: milestone === null ? null : milestoneName(milestone, terms) })
      if (component !== undefined) fields.push({ field: 'component', to: component === null || component.trim() === '' ? null : componentName(component, terms, reader.prefix) })
      const add = labels.add.map((each) => labelName(each, terms))
      const setEstimate = estimate === null ? null : estimateOf(editor, terms)
      if (attach.length > 0) filesOf(editor, terms, reader.prefix)
      const files = attach.length === 0 ? [] : await this.uploads(attach, scope, reader)
      const said: string[] = []
      try {
        const notes: string[] = []
        if (whole !== undefined && (await editor.describe(key, whole, rev!, notes))) said.push('description replaced', ...notes)
        if ((patches.length > 0 || append !== null) && (await editor.patch(key, patches, append, notes))) said.push('description patched', ...notes)
        for (const field of fields) if (await editor.set(key, field)) said.push(fieldLine(field))
        if (setEstimate !== null && (await setEstimate(key, estimate!))) said.push(`estimate → ${estimate} min`)
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
        if (files.length > 0) {
          const notes: string[] = []
          await editor.files!.attach(key, files, notes)
          said.push(`attached ${files.map((file) => file.name).join(', ')}`, ...notes)
        }
      } catch (error) {
        throw new EditRefused(`${said.length === 0 ? '' : `${key}: ${said.join('; ')}; then `}${refusalText(error)}`)
      } finally {
        if (said.length > 0) await this.deps.refresh(reader.project)
      }
      return said.length === 0 ? `${key}: already so` : `${key}: ${said.join('; ')}`
    })
  }

  private async comment(args: Args, scope: TasksScope): Promise<string> {
    const key = args.required('key').trim().toUpperCase()
    const body = args.required('text')
    const reader = this.readerOfTask(key, scope)
    const model = scope.task === null || scope.project === null ? null : this.deps.modelOf(scope.project, scope.task)
    const attach = args.texts('attach')
    const notes: string[] = []
    const attached = await this.deps.run(reader.id, async (tracker) => {
      const editor = editorOf(tracker)
      if (attach.length === 0) {
        await editor.comment(key, body, model, notes)
        return []
      }
      const files = filesOf(editor, await this.termsOf(tracker, reader.id), reader.prefix)
      const uploads = await this.uploads(attach, scope, reader)
      await files.comment(key, body, uploads, model, notes)
      return uploads.map((file) => file.name)
    })
    await this.deps.refresh(reader.project)
    return [`${key}: comment added${attached.length === 0 ? '' : ` with ${attached.join(', ')}`}`, ...notes].join('; ')
  }

  /** The files `paths` names, read from the session's working folder. */
  private async uploads(paths: string[], scope: TasksScope, reader: TaskReader) {
    const folder = this.deps.folderOf(scope, reader.project)
    if (folder === null) throw new EditRefused("this session's working folder is not known: nothing can be attached; name the file in the text instead")
    return readUploads(paths, folder, this.deps.attachmentLimit())
  }

  private async termsOf(tracker: Tracker, reader: string): Promise<TrackerTerms> {
    return termsOf(tracker, reader, this.deps.rulesOf(reader))
  }

  /**
   * The trackers of the call's project: the address's, or in a hand session the project whose key — its own or a
   * feed's — `project` gives; `named` — the tracker that key gives.
   */
  private projectOf(args: Args, scope: TasksScope): { readers: TaskReader[]; named: TaskReader | null } {
    if (scope.project !== null) return { readers: this.deps.readers(scope.project), named: null }
    const key = args.text('project')?.trim().toUpperCase()
    if (key === undefined || key === '') throw new EditRefused('"project" is required: the key of the project, as in its task keys')
    const named = this.deps.readerOfPrefix(key)
    if (named === null) throw new EditRefused(`no project ${key} keeps its tasks where these tools reach`)
    return { readers: this.deps.readers(named.project), named }
  }

  /** The tracker of a task by its key's prefix: one of the address's project, or of any project in a hand session. */
  private readerOfTask(key: string, scope: TasksScope): TaskReader {
    const parsed = parseTaskId(key)
    if (parsed === null) throw new EditRefused(`"${key}" is not a task key such as ABC-12`)
    if (scope.project === null) {
      const found = this.deps.readerOfPrefix(parsed.project)
      if (found === null) throw new EditRefused(`no project ${parsed.project} keeps its tasks where these tools reach`)
      return found
    }
    const readers = this.deps.readers(scope.project)
    const found = readers.find((each) => each.prefix === parsed.project)
    if (found === undefined) throw new EditRefused(`${key} is not a task of this project; its trackers give ${readers.map((each) => each.prefix).join(', ')} keys`)
    return found
  }
}

/** The tracker `tracker` names among the project's; `null` — none named. */
function trackerArg(args: Args, readers: TaskReader[]): TaskReader | null {
  const prefix = args.text('tracker')?.trim().toUpperCase()
  if (prefix === undefined || prefix === '') return null
  const found = readers.find((each) => each.prefix === prefix)
  if (found === undefined) throw new EditRefused(`the project has no tracker ${prefix}; its trackers are ${readers.map((each) => each.prefix).join(', ')}`)
  return found
}

/** A key of another tracker than the one of `prefix`: links and parents never cross trackers. */
function crossesTrackers(key: string, prefix: string): boolean {
  const parsed = parseTaskId(key)
  return parsed !== null && parsed.project !== prefix
}

const crossRefusal = (key: string) => `${key} is in another tracker; links don't cross trackers; name the key in the description`

interface PlannedTask {
  draft: TaskDraft
  links: Record<TaskLink, string[]>
  /** The paths of the files to attach once the task is created. */
  attach: string[]
}

/** Checks every name and reference of a batch's task before anything is created. */
function plannedTask(item: Args, index: number, count: number, terms: TrackerTerms, prefix: string): PlannedTask {
  const ref = (value: string, earlier: boolean): string => {
    const trimmed = value.trim()
    if (!trimmed.startsWith('#')) {
      if (parseTaskId(trimmed.toUpperCase()) === null) throw new EditRefused(`task ${index + 1}: "${trimmed}" is neither a task key nor #N`)
      if (crossesTrackers(trimmed.toUpperCase(), prefix)) throw new EditRefused(`task ${index + 1}: ${crossRefusal(trimmed.toUpperCase())}`)
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
  const estimate = estimateArg(item)
  if (estimate !== null && !terms.estimate) throw new EditRefused(`task ${index + 1}: ${NO_ESTIMATE}`)
  const component = item.text('component')?.trim()
  const attach = item.texts('attach')
  const task = (refuse: () => unknown) => {
    try {
      return refuse()
    } catch (error) {
      throw new EditRefused(`task ${index + 1}: ${refusalText(error)}`)
    }
  }
  if (attach.length > 0) task(() => filesCheck(terms, prefix))
  return {
    attach,
    draft: {
      title: item.required('title').trim(),
      description: item.text('description') ?? '',
      status: status === undefined ? null : statusName(status, terms),
      priority: item.priority('priority') ?? null,
      milestone: milestone === undefined || milestone.trim() === '' ? null : milestoneName(milestone, terms),
      labels: item.texts('labels').map((each) => labelName(each, terms)),
      parent: parent === undefined || parent.trim() === '' ? null : ref(parent, true),
      estimate,
      ...(component === undefined || component === '' ? {} : { component: task(() => componentName(component, terms, prefix)) as string }),
    },
    links: Object.fromEntries(LINKS.map((link) => [link, item.texts(link).map((each) => ref(each, false))])) as Record<TaskLink, string[]>,
  }
}

function editorOf(tracker: Tracker): TaskEditor {
  if (tracker.editor === undefined) throw new EditRefused("these tools do not serve this project's tracker; use the tracker's own MCP server")
  return tracker.editor
}

const NO_ESTIMATE = 'this tracker keeps no estimate; send the task without one'

/** Minutes of the agent's active work: a whole positive number; `null` — none given. */
function estimateArg(args: Args): number | null {
  const minutes = args.integer('estimate')
  if (minutes === undefined) return null
  if (minutes < 1) throw new EditRefused('"estimate" is minutes of your active work, a whole number from 1')
  return minutes
}

function estimateOf(editor: TaskEditor, terms: TrackerTerms): (id: string, minutes: number) => Promise<boolean> {
  const set = editor.estimate
  if (set === undefined || !terms.estimate) throw new EditRefused(NO_ESTIMATE)
  return (id, minutes) => set.call(editor, id, minutes)
}

/** A refused name: what was wrong with the tracker's list, then its roles line, so the retry picks by role. */
const nameRefusal = (text: string, terms: TrackerTerms) => new EditRefused(`${text}\n${rolesLine(terms)}`)

function statusName(name: string, terms: TrackerTerms): string {
  const known = vocabularyFor(terms)
  const found = known.statuses.find((each) => each.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())
  if (found === undefined) throw nameRefusal(`there is no status "${name}"; the statuses are ${known.statuses.map((each) => each.name).join(', ')}`, terms)
  return found.name
}

function milestoneName(name: string, terms: TrackerTerms): string {
  const list = vocabularyFor(terms).milestones ?? []
  const found = list.find((each) => each.toLocaleLowerCase() === name.trim().toLocaleLowerCase())
  if (found === undefined) {
    throw nameRefusal(`there is no milestone "${name}"; ${list.length === 0 ? 'the project has none' : `the milestones are ${list.join(', ')}`}. Only the user makes a new one`, terms)
  }
  return found
}

function labelName(name: string, terms: TrackerTerms): string {
  // A run label is not a name of the vocabulary: it goes on a tracker that gives none too.
  if (terms.known === null && runLabelOf(name) !== null) return name.trim()
  const known = vocabularyFor(terms)
  const found = known.labels.find((each) => each.toLocaleLowerCase() === name.trim().toLocaleLowerCase())
  if (found !== undefined) return found
  if (runLabelOf(name) !== null) return name.trim()
  throw nameRefusal(`there is no label "${name}"; the labels are ${known.labels.join(', ')}. Only the user makes a new one`, terms)
}

function componentName(name: string, terms: TrackerTerms, prefix: string): string {
  const list = terms.components
  if (list === null) throw new EditRefused(`${prefix} has no components; send the task without one, or name the area with a label`)
  const found = list.find((each) => sameName(each, name))
  if (found === undefined) {
    throw nameRefusal(`there is no component "${name.trim()}"; ${list.length === 0 ? 'the project has none' : `the components are ${list.join(', ')}`}. Only the user makes a new one`, terms)
  }
  return found
}

function filesCheck(terms: TrackerTerms, prefix: string): void {
  if (!terms.attachments) throw new EditRefused(`${prefix} takes no attachments through these tools; name the file in the text instead`)
}

/** The editor's files, refused for a tracker that takes none. */
function filesOf(editor: TaskEditor, terms: TrackerTerms, prefix: string): TaskFiles {
  filesCheck(terms, prefix)
  return editor.files!
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
export function cardText(card: TrackerCard, rev: number, comments: boolean, roles: string | null = null): string {
  const refs = (list: { id: string }[]) => list.map((each) => each.id).join(', ')
  const head = [
    card.status.name,
    ...(card.priority === 'none' ? [] : [`priority ${card.priority}`]),
    ...(card.milestone === null ? [] : [`milestone ${card.milestone.label}`]),
    ...(card.labels.length === 0 ? [] : [`labels ${card.labels.join(', ')}`]),
    ...(card.estimate == null ? [] : [`estimate ${card.estimate} min`]),
    ...(card.parent === null ? [] : [`parent ${card.parent.id}`]),
    ...(card.blockedBy.length === 0 ? [] : [`blocked by ${refs(card.blockedBy)}`]),
    ...(card.blocks.length === 0 ? [] : [`blocks ${refs(card.blocks)}`]),
    ...(card.related.length === 0 ? [] : [`relates ${refs(card.related)}`]),
    `rev ${rev}`,
  ]
  const top = roles === null ? head.join(' · ') : `${head.join(' · ')}\n${roles}`
  const parts = [`# ${card.id} ${card.title}`, top, card.description.trim() === '' ? '(no description)' : card.description.trim()]
  const files = card.attachments.filter((each) => each.path !== undefined)
  if (files.length > 0) {
    const lines = files.map((each) => `- ${each.name} (${sizeText(each.size)}) — ${each.missing ? 'file missing' : each.path}`)
    parts.push(`## Attachments\n\n${lines.join('\n')}`)
  }
  if (comments) {
    const head = (each: TaskComment) => {
      const model = each.journal?.model == null ? '' : ` (${each.journal.model})`
      return `${each.author ?? 'Person'}${model}, ${new Date(each.at).toISOString().slice(0, 16).replace('T', ' ')}\n\n${each.text.trim()}`
    }
    const list = card.comments.map((each) =>
      [`### ${head(each)}`, ...(each.replies ?? []).map((reply) => `#### ↳ reply: ${head(reply)}`)].join('\n\n'),
    )
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
