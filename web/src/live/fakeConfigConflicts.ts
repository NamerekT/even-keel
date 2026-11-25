import { fail, notice } from '../../../src/notice/notice.js'
import type { ConfigConflictView, EvenKeelState } from '../../../src/state.js'
import { ago } from './fakeSessions.js'

const settings = (model: string, theme: string) =>
  `${JSON.stringify({ model, theme, permissions: { allow: ['Bash(npm test:*)', 'Bash(git status)'] }, statusLine: { type: 'command', command: 'node ~/.claude/statusline.mjs' } }, null, 2)}\n`

const HOOK = (limit: number) =>
  `#!/usr/bin/env node\n// Refuses a Bash call that would print a file over the limit.\nconst LIMIT = ${limit} * 1024\nconst input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'))\nif ((input.tool_input?.command ?? '').length > LIMIT) process.exit(2)\n`

/**
 * `?configConflict=on` (BTN-1692): settings.json met on a laptop, a hook with no machine known; `gone` the same, but a
 * choice fails as when the conflict was settled elsewhere first.
 */
export function fakeConfigConflicts(mode: string | null): ConfigConflictView[] | undefined {
  if (mode !== 'on' && mode !== 'gone') return undefined
  return [
    {
      file: 'settings.json',
      machine: 'laptop-01',
      since: ago(42),
      notice: notice('memory.configConflict', { file: 'settings.json', machine: 'laptop-01' }),
      hash: 'fake-settings',
      kept: settings('opus', 'dark'),
      other: settings('sonnet', 'light'),
    },
    {
      file: 'hooks/output-guard.mjs',
      machine: null,
      since: ago(7),
      notice: notice('memory.configConflictAnywhere', { file: 'hooks/output-guard.mjs' }),
      hash: 'fake-hook',
      kept: HOOK(64),
      other: HOOK(32),
    },
  ]
}

/** "Keep this" and "Take the other": the fake conflict is gone at once, or with `gone` the choice is refused. */
export function fakeConfigConflictCommand(state: EvenKeelState, name: string, body: Record<string, unknown>, mode: string | null): EvenKeelState | null {
  if (name !== 'config/settleConflict' || state.configConflicts === undefined) return null
  if (mode === 'gone') throw fail('config.conflictGone', { file: String(body.file) })
  return { ...state, configConflicts: state.configConflicts.filter((each) => each.file !== body.file) }
}
