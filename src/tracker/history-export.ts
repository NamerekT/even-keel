import type { TaskChange } from './history.js'

/** A single Markdown comment: destination trackers cannot import their native past events. */
export function historySummary(changes: readonly TaskChange[]): string {
  const cell = (value: string | null) => (value ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/\r?\n/g, '<br>')
  const rows = [...changes].sort((a, b) => a.at - b.at).map((change) => {
    const when = new Date(change.at).toISOString().slice(0, 16).replace('T', ' ')
    const who = change.name ?? (change.by === 'service' ? 'Even Keel' : change.by === 'person' ? 'Person' : 'Agent')
    const author = change.model === null ? who : `${who} (${change.model})`
    const value = change.field === 'description'
      ? (change.diff ?? []).map((line) => line.kind === 'skipped' ? `⋯ ${line.lines} lines` : `${line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '} ${line.text}`).join('\n')
      : `${change.from ?? '—'} → ${change.to ?? '—'}`
    return `| ${when} | ${cell(author)} | ${cell(change.field)} | ${cell(value)} |`
  })
  return ['## Change history', '', '| When (UTC) | Who | Field | Before → after |', '| --- | --- | --- | --- |', ...rows].join('\n')
}
