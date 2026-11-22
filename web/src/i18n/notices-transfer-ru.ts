import type { TRANSFER_NOTICES } from '../../../src/notice/en-transfer.js'
import type { NoticeTexts } from '../../../src/notice/notice.js'
import type { TransferItem, TransferStage } from '../../../src/tracker/transfer-stop.js'

const STAGES: Record<TransferStage, string> = {
  read: 'при чтении задач',
  components: 'при записи компонентов',
  milestones: 'при записи вех',
  create: 'при создании задачи',
  links: 'при записи связей',
  attach: 'при переносе вложений',
  journal: 'при переносе комментариев',
  history: 'при записи истории изменений',
  fields: 'при обновлении полей',
  mark: 'при пометке задачи о переносе',
  check: 'при сверке',
}

const ITEMS: Record<TransferItem['kind'], string> = { file: 'файл', comment: 'комментарий', milestone: 'веха', component: 'компонент' }

const itemText = (item: TransferItem): string => (item.kind === 'comment' ? `комментарий ${item.number} из ${item.of}` : `${ITEMS[item.kind]} ${item.name}`)

export const TRANSFER_NOTICES_RU = {
  'transfer.stop': (p) => {
    const said = `${STAGES[p.stage]}${p.item === null ? '' : ` (${itemText(p.item)})`}`
    return p.task === null ? `${said[0]!.toUpperCase()}${said.slice(1)}` : `На ${p.task}, ${said}`
  },
  'transfer.reason': () => 'Причина',
} satisfies { [K in keyof typeof TRANSFER_NOTICES]: NoticeTexts[K] }
