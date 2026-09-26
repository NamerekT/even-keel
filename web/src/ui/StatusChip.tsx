import type { ChainStatus } from '../state.js'

const STATUS_LABELS: Record<ChainStatus['kind'], string> = {
  running: 'идёт',
  paused: 'пауза',
  queued: 'в очереди',
  idle: 'не запущена',
}

export function StatusChip({ status }: { status: ChainStatus }) {
  return (
    <span className={`chip chip--${status.kind}`}>
      {STATUS_LABELS[status.kind]}
      {status.kind === 'queued' && <span className="chip__extra"> · {status.position}-я</span>}
    </span>
  )
}
