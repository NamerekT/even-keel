/**
 * A failed `execFile` in a line: how it ended and what the CLI printed, without the command line `message` starts with.
 * A spawn that never ran (`spawn ENAMETOOLONG`, `spawn claude ENOENT`) printed nothing: its message is the reason (BTN-1505).
 */
export function execFailure(error: unknown): string {
  const { code, killed } = error as { code?: unknown; killed?: boolean }
  const ended = killed === true ? 'timed out' : typeof code === 'number' ? `exit code ${code}` : undefined
  if (ended === undefined) return error instanceof Error ? error.message : String(error)
  return [ended, outputOf(error)].filter(Boolean).join(' / ')
}

function outputOf(error: unknown): string {
  const { stdout, stderr } = error as { stdout?: string; stderr?: string }
  return [stderr, stdout].map((text) => text?.trim()).filter(Boolean).join(' / ')
}
