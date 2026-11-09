import { BADGE_VERSION, type BadgeState } from 'even-keel-badge'

const TASK_STATES = ['working', 'waiting']
const CHAIN_STATES = ['running', 'paused', 'stopped', 'idle']
const CHIP_STATES = ['done', 'working', 'waiting', 'queued']

type Fields = Record<string, unknown>

const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isTime = (value: unknown): boolean => isString(value) && !Number.isNaN(Date.parse(value))
const optional = (value: unknown, check: (value: unknown) => boolean): boolean => value === undefined || check(value)

/**
 * A pushed body as the badge's state, contract version 1 (`docs/badge.md`): every key `renderBadge` reads has its type,
 * a field the project left out is absent. Anything else is `null`, and the push is refused.
 */
export function parseBadgeState(body: string): BadgeState | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (!isObject(value) || value.v !== BADGE_VERSION || !isTime(value.at)) return null
  const { project, active, chain, milestone, stats } = value
  if (!isObject(project) || !isString(project.key) || !isString(project.name)) return null
  if (!Array.isArray(active) || !active.every(isTask)) return null
  if (!isChain(chain)) return null
  if (!optional(milestone, (item) => item === null || (isObject(item) && isString(item.name) && isNumber(item.done) && isNumber(item.left)))) return null
  if (!optional(stats, (item) => isObject(item) && ['sessions', 'medianCost', 'medianMinutes'].every((key) => optional(item[key], isNumber)))) return null
  return value as unknown as BadgeState
}

function isTask(task: unknown): boolean {
  if (!isObject(task) || !isString(task.key) || !TASK_STATES.includes(task.state as string)) return false
  const action = (item: unknown) => item === null || (isObject(item) && isString(item.tool) && isString(item.text))
  return (
    optional(task.titleEn, isString) &&
    optional(task.agent, isString) &&
    optional(task.model, isString) &&
    optional(task.startedAt, isTime) &&
    optional(task.action, action) &&
    optional(task.context, isNumber)
  )
}

function isChain(chain: unknown): boolean {
  if (!isObject(chain) || !CHAIN_STATES.includes(chain.state as string)) return false
  if (chain.next !== null && !isString(chain.next)) return false
  const chip = (item: unknown) => isObject(item) && isString(item.key) && CHIP_STATES.includes(item.state as string)
  return optional(chain.tasks, (tasks) => Array.isArray(tasks) && tasks.every(chip))
}
