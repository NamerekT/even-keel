const EXTENSION_DIR = /^anthropic\.claude-code-(\d+)\.(\d+)\.(\d+)(?:-.+)?$/

export function projectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

export function newestExtensionBinary(dirNames: string[]): string | undefined {
  let best: { name: string; version: number[] } | undefined
  for (const name of dirNames) {
    const match = EXTENSION_DIR.exec(name)
    if (match === null) continue
    const version = match.slice(1).map(Number)
    if (best === undefined || compareVersions(version, best.version) > 0) best = { name, version }
  }
  return best?.name
}

function compareVersions(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
