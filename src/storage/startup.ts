import { DatabaseHeldError } from './owner.js'

export interface BlockedPage {
  update(error: unknown): void
  close(): Promise<void>
}

/** Only ownership refusals are transient; a failed migration keeps the page blocked until a restart. */
export async function startWithStorageRetry(deps: {
  prepare(): Promise<void>
  blocked(error: unknown): Promise<BlockedPage>
  log(line: string): void
}): Promise<boolean> {
  let page: BlockedPage | undefined
  for (;;) {
    try {
      await deps.prepare()
      break
    } catch (error) {
      if (page === undefined) page = await deps.blocked(error)
      else page.update(error)
      if (!(error instanceof DatabaseHeldError)) return false
      await new Promise<void>((resolve) => setTimeout(resolve, 3_000))
    }
  }
  if (page !== undefined) {
    await page.close()
    deps.log('storage: database opened after waiting; starting the service')
  }
  return true
}
