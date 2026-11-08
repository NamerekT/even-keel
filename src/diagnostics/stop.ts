import { writeSync } from 'node:fs'

/** Observe fatal errors without replacing Node's default nonzero exit and stack trace. */
export function logFatalErrors(): void {
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    writeSync(2, `stopping: ${origin}\n${error.stack ?? String(error)}\n`)
  })
}

export function stopOnSignals(shutdown: () => Promise<unknown>, deadlineMs: number): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      console.log(`stopping: ${signal}`)
      setTimeout(() => process.exit(0), deadlineMs).unref()
      void shutdown().finally(() => process.exit(0))
    })
  }
}
