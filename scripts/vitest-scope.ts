const FOLDERS = ['src/e2e', 'src/e2e-cli', 'src/e2e-trackers']

/**
 * The end-to-end folders a vitest run leaves out, as globs for `test.exclude` (docs/chain/e2e.md): every one of them
 * unless an argument of the run names it (`vitest run src/e2e/ci-fix`) or the mode is `all` (`npm run test:all`).
 * So a bare `vitest run` runs what `npm test` does, while the folder filters of `test:e2e` and the CI jobs still reach their files.
 */
export function excludedEndToEnd(args: readonly string[], mode: string): string[] {
  if (mode === 'all') return []
  const paths = args.map(arg => arg.replaceAll('\\', '/'))
  return FOLDERS
    .filter(folder => !paths.some(path => new RegExp(`(^|/)${folder}(/|$)`).test(path)))
    .map(folder => `${folder}/**`)
}
