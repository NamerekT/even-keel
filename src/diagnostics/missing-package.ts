/** The package a failed import could not find: a dependency not installed yet, not a missing file of the project. */
export function missingPackageOf(error: unknown): string | undefined {
  if (!(error instanceof Error) || (error as { code?: unknown }).code !== 'ERR_MODULE_NOT_FOUND') return undefined
  return /^Cannot find package '([^']+)'/.exec(error.message)?.[1]
}

export function missingPackageLine(name: string, root: string): string {
  return `even-keel cannot start: the package ${name} is not installed. Run \`npm install\` in ${root}, then start it again`
}
