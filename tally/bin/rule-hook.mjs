#!/usr/bin/env node
// Claude Code hook: a session that edits a rule file is asked to log why in the rule history (tally/src/rule-hook.ts).
// Usage in ~/.claude/settings.json, PostToolUse with the matcher "Edit|MultiEdit|Write" and Stop:
//   node "<main checkout>/tally/bin/rule-hook.mjs"
// It never fails a tool call or a stop: any error ends it silently.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Edits of files that cannot be rules end here, before TypeScript is loaded.
const MAYBE_RULE = /\.claude|\.githooks|claude\.md$/i

try {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const path = input.tool_input?.file_path
  if (input.hook_event_name !== 'PostToolUse' || (typeof path === 'string' && MAYBE_RULE.test(path))) {
    const { tsImport } = await import('tsx/esm/api')
    const { runHook } = await tsImport('../src/rule-hook.ts', import.meta.url)
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const output = runHook(input, { root, env: process.env, home: homedir() })
    if (output !== null) process.stdout.write(JSON.stringify(output))
  }
} catch {
  // A broken hook must not stand in a session's way.
}
