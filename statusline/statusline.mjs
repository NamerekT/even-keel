// Claude Code statusLine command: records the subscription rate limits for Baton and prints a short status line.
// Usage in ~/.claude/settings.json: node "<baton>/statusline/statusline.mjs" [target-file]
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const target = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'state', 'rate-limits.json')

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  let data = {}
  try {
    data = JSON.parse(input)
  } catch {}
  try {
    record(data.rate_limits)
  } catch {}
  process.stdout.write(line(data))
})

function record(rateLimits) {
  if (typeof rateLimits !== 'object' || rateLimits === null) return
  mkdirSync(dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  try {
    writeFileSync(temp, JSON.stringify({ receivedAt: new Date().toISOString(), rate_limits: rateLimits }))
    renameSync(temp, target)
  } finally {
    rmSync(temp, { force: true })
  }
}

function line(data) {
  const parts = []
  if (typeof data.model?.display_name === 'string') parts.push(data.model.display_name)
  const context = data.context_window?.used_percentage
  if (typeof context === 'number') parts.push(`ctx ${Math.round(context)}%`)
  const fiveHour = data.rate_limits?.five_hour?.used_percentage
  if (typeof fiveHour === 'number') parts.push(`5h ${Math.round(fiveHour)}%`)
  const sevenDay = data.rate_limits?.seven_day?.used_percentage
  if (typeof sevenDay === 'number') parts.push(`7d ${Math.round(sevenDay)}%`)
  return parts.join(' · ')
}
