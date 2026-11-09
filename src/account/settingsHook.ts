import { readFileSync } from 'node:fs'
import { guardSettingsEdit, type SettingsGuardConfig } from './settingsGuard.js'

try {
  const index = process.argv.indexOf('--even-keel-account-settings')
  const config = JSON.parse(Buffer.from(process.argv[index + 1]!, 'base64url').toString('utf8')) as SettingsGuardConfig
  const reason = await guardSettingsEdit(JSON.parse(readFileSync(0, 'utf8')), config)
  if (reason !== null) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: {
      hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason,
    } }))
  }
} catch {
  // An unavailable service or malformed hook input must not hold an unrelated edit.
}
