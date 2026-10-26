import { join } from 'node:path'

export interface DownloadCheck {
  agent: string
  version: string
  target: string | null
  check: (into: string) => Promise<string>
}

export interface DownloadRow {
  agent: string
  platform: string
  target: string
  version: string
  seconds: string
  result: string
}

export function checkedVersion(output: string, expected: string): string {
  const text = output.trim().replace(/\s+/g, ' ')
  if (text === '') throw new Error('empty version output')
  const versions: string[] = text.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/g) ?? []
  if (!versions.includes(expected)) throw new Error(`expected ${expected}, received ${text}`)
  return text
}

/** A failed download must not hide the results of the remaining adapters. */
export async function checkDownloads(checks: DownloadCheck[], root: string, platform: string): Promise<{ rows: DownloadRow[]; failed: boolean }> {
  const rows: DownloadRow[] = []
  let failed = false
  for (const check of checks) {
    const started = performance.now()
    let result = 'SKIP: no package for this platform'
    if (check.target !== null) {
      try {
        result = `OK: ${checkedVersion(await check.check(join(root, check.agent)), check.version)}`
      } catch (error) {
        failed = true
        result = `FAIL: ${error instanceof Error ? error.message : String(error)}`.replace(/\s+/g, ' ')
      }
    }
    rows.push({ agent: check.agent, platform, target: check.target ?? 'unavailable', version: check.version, seconds: ((performance.now() - started) / 1000).toFixed(1), result })
  }
  return { rows, failed }
}

export function downloadSummary(rows: DownloadRow[]): string {
  const cell = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/[\r\n]/g, ' ')
  return [
    '| Agent | Platform | Package or target | Checked | Seconds | Version or error |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${[row.agent, row.platform, row.target, row.version, row.seconds, row.result].map(cell).join(' | ')} |`),
    '',
  ].join('\n')
}
