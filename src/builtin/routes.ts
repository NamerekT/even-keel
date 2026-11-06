import type { IncomingMessage } from 'node:http'
import { fail } from '../notice/notice.js'
import type { ServerDeps } from '../server.js'
import { labelList, numberOf, projectOf, taskOf, textOf } from '../server-request.js'
import { PRIORITIES, type TaskPriority } from '../tracker/model.js'
import type { BuiltinControl, BuiltinDraft, BuiltinEdit } from './control.js'
import type { RelationKind } from './model.js'

type Query = (deps: ServerDeps, body: Record<string, unknown>, request: IncomingMessage) => Promise<unknown>

/** The page's commands on the built-in tracker (BTN-767); each answers with what it changed. */
export const BUILTIN_QUERIES: Record<string, Query> = {
  'builtin/create': (deps, body) => control(deps).create(projectOf(body), draftOf(body)),
  'builtin/edit': (deps, body) => control(deps).edit(taskOf(body), editOf(body)),
  'builtin/description': (deps, body) => control(deps).describe(taskOf(body), textOf(body.text, 'text'), numberOf(body.rev, 'rev')),
  'builtin/patch': (deps, body) => control(deps).patch(taskOf(body), textOf(body.old, 'old'), textOf(body.new, 'new')),
  'builtin/labels': (deps, body) =>
    control(deps).relabel(taskOf(body), { add: labelList(body.add ?? [], 'add'), remove: labelList(body.remove ?? [], 'remove') }),
  'builtin/milestone': (deps, body) => control(deps).milestone(projectOf(body), textOf(body.name, 'name'), dateOf(body.date)),
  'builtin/relate': (deps, body) => control(deps).relate(taskOf(body), textOf(body.other, 'other'), kindOf(body.kind), true),
  'builtin/unrelate': (deps, body) => control(deps).relate(taskOf(body), textOf(body.other, 'other'), kindOf(body.kind), false),
  'builtin/comment': (deps, body) => control(deps).comment(taskOf(body), textOf(body.text, 'text')),
  'builtin/uncomment': async (deps, body) => {
    await control(deps).uncomment(taskOf(body), textOf(body.comment, 'comment'))
    return {}
  },
  'builtin/search': (deps, body) =>
    control(deps).search(textOf(body.text ?? '', 'text'), body.project === null || body.project === undefined ? null : projectOf(body)),
  'builtin/delete': async (deps, body) => {
    await control(deps).remove(taskOf(body))
    return {}
  },
}

function control({ builtin }: ServerDeps): BuiltinControl {
  if (builtin === undefined) throw fail('builtin.off', {})
  return builtin
}

function draftOf(body: Record<string, unknown>): BuiltinDraft {
  return {
    title: textOf(body.title, 'title'),
    ...(body.description === undefined ? {} : { description: textOf(body.description, 'description') }),
    ...(body.status === undefined ? {} : { status: textOf(body.status, 'status') }),
    ...(body.priority === undefined ? {} : { priority: priorityOf(body.priority, 'priority') }),
    ...(body.milestone === undefined ? {} : { milestone: nullableText(body.milestone, 'milestone') }),
    ...(body.parent === undefined ? {} : { parent: nullableText(body.parent, 'parent') }),
    ...(body.labels === undefined ? {} : { labels: labelList(body.labels, 'labels') }),
  }
}

function editOf(body: Record<string, unknown>): BuiltinEdit {
  const field = body.field
  switch (field) {
    case 'title':
      return { field, from: textOf(body.from, 'from'), to: textOf(body.to, 'to') }
    case 'status':
      return { field, from: textOf(body.from, 'from'), to: textOf(body.to, 'to') }
    case 'priority':
      return { field, from: priorityOf(body.from, 'from'), to: priorityOf(body.to, 'to') }
    case 'milestone':
      return { field, from: nullableText(body.from, 'from'), to: nullableText(body.to, 'to') }
    case 'parent':
      return { field, from: nullableText(body.from, 'from'), to: nullableText(body.to, 'to') }
    case 'description':
      return { field, from: textOf(body.from, 'from'), to: textOf(body.to, 'to') }
    default:
      throw fail('request.required', { field: 'field' })
  }
}

function priorityOf(raw: unknown, field: string): TaskPriority {
  if (typeof raw !== 'string') throw fail('request.required', { field })
  if (!(PRIORITIES as readonly string[]).includes(raw)) throw fail('builtin.badPriority', { priority: raw })
  return raw as TaskPriority
}

function nullableText(raw: unknown, field: string): string | null {
  return raw === null ? null : textOf(raw, field)
}

function dateOf(raw: unknown): number | null {
  return raw === null || raw === undefined ? null : numberOf(raw, 'date')
}

function kindOf(raw: unknown): RelationKind {
  if (raw !== 'blocks' && raw !== 'relates') throw fail('request.required', { field: 'kind' })
  return raw
}
