import { fail } from '../notice/notice.js'

/** The projects whose tasks are being copied to another tracker now (BTN-1073); the service's own, as the adapter's database is. */
const running = new Set<string>()

export function isExporting(project: string): boolean {
  return running.has(project)
}

/**
 * Refuses a change of the project's tasks while they are copied: a change after its task's copy would be lost. The
 * page's commands and the tasks server's writes ask it; the copy itself writes past it.
 */
export function refuseWhileExporting(...projects: string[]): void {
  if (projects.some((project) => running.has(project))) throw fail('builtin.exporting', {})
}

/** Runs the copy of the project with its tasks' changes refused; a copy running already is refused too. */
export async function whileExporting<T>(project: string, work: () => Promise<T>): Promise<T> {
  refuseWhileExporting(project)
  running.add(project)
  try {
    return await work()
  } finally {
    running.delete(project)
  }
}
