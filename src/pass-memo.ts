/**
 * Answers kept for one pass of reads that ask the same thing many times, such as one computation of the machine's
 * facts. Outside a pass every read computes anew. The pass must not change what its reads depend on.
 */
export class PassMemo {
  private kept: Map<string, unknown> | undefined

  run<T>(body: () => T): T {
    if (this.kept !== undefined) return body()
    this.kept = new Map()
    try {
      return body()
    } finally {
      this.kept = undefined
    }
  }

  of<T>(key: string, compute: () => T): T {
    if (this.kept === undefined) return compute()
    if (this.kept.has(key)) return this.kept.get(key) as T
    const value = compute()
    this.kept.set(key, value)
    return value
  }
}
