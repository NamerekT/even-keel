export interface MergeCloserOptions {
  merged: (project: string, task: string) => Promise<boolean>
  /** `false` — the task was already closed. */
  complete: (task: string) => Promise<boolean>
  onError?: (error: unknown) => void
}

export class MergeCloser {
  private readonly closed = new Set<string>()

  constructor(private readonly options: MergeCloserOptions) {}

  async sweep(project: string, tasks: string[]): Promise<string[]> {
    const closed: string[] = []
    for (const task of tasks) {
      if (this.closed.has(task)) continue
      try {
        if (!(await this.options.merged(project, task))) continue
        const moved = await this.options.complete(task)
        this.closed.add(task)
        if (moved) closed.push(task)
      } catch (error) {
        this.options.onError?.(error)
      }
    }
    return closed
  }
}
