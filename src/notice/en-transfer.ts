import type { TransferItem, TransferStage } from '../tracker/transfer-stop.js'

const STAGES: Record<TransferStage, string> = {
  read: 'while reading the tasks',
  components: 'while writing the components',
  milestones: 'while writing the milestones',
  create: 'while creating the task',
  links: 'while writing its links',
  attach: 'while moving its attachments',
  journal: 'while moving its comments',
  history: 'while writing its change log',
  fields: 'while updating its fields',
  mark: 'while marking it as moved',
  check: 'while checking',
}

const itemText = (item: TransferItem): string => {
  if (item.kind === 'file') return `the file ${item.name}`
  if (item.kind === 'comment') return `comment ${item.number} of ${item.of}`
  return `the ${item.kind} ${item.name}`
}

export interface TransferStopParams {
  stage: TransferStage
  task: string | null
  item: TransferItem | null
  /** The task in its tracker, for the page's link. */
  url: string | null
}

/** Where an import or a copy stopped (BTN-1455): the cause of its `import.failed`, `export.failed` and their event lines. */
export const TRANSFER_NOTICES = {
  'transfer.stop': (p: TransferStopParams) => {
    const said = `${STAGES[p.stage]}${p.item === null ? '' : ` (${itemText(p.item)})`}`
    return p.task === null ? `${said[0]!.toUpperCase()}${said.slice(1)}` : `On ${p.task}, ${said}`
  },
  'transfer.reason': () => 'The reason',
}
