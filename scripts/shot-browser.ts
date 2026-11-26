/** The browser shared by `npm run shot` and `npm run guide-shots`: Playwright's headless shell and the in-process `dev:fake` server. */
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { ROOT } from './shot-step.ts'

/**
 * Only Playwright's headless shell, never the installed Chrome: on Windows a fresh Chrome profile checks
 * for a blank OS password with LogonUser, so every launch was a failed logon and a few runs locked the account.
 */
export async function launch(extra: string[] = []): Promise<Browser> {
  try {
    // A fake microphone answers getUserMedia without a prompt, so the chat's recording can be shot.
    return await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...extra] })
  } catch (error) {
    throw new Error(`no browser: run \`npx playwright install chromium-headless-shell\`\n${String(error)}`)
  }
}

export async function fakeServer(): Promise<{ server: ViteDevServer; base: string }> {
  const server = await createServer({
    configFile: join(ROOT, 'web/vite.config.ts'),
    mode: 'fake',
    logLevel: 'error',
    server: { port: 0, strictPort: false, hmr: false },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('the fake server has no port')
  return { server, base: `http://localhost:${address.port}` }
}
