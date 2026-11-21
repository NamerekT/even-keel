import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { linksOf, openLoginBrowser, type LoginBrowser } from './login-browser.js'

const LINK = 'https://claude.ai/oauth/authorize?code=true&client_id=fake&redirect_uri=http%3A%2F%2Flocalhost%3A54321%2Fcallback&state=x1'

let browser: LoginBrowser | undefined
afterEach(() => browser?.remove())

/** Calls the program as the CLI does: on Windows a `.cmd` goes through cmd.exe with the link quoted, as Bun does it. */
function call(program: string, link: string) {
  const ran = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', `""${program}" "${link}""`], { windowsVerbatimArguments: true, windowsHide: true })
    : spawnSync(program, [link])
  expect(ran.status).toBe(0)
}

describe('the BROWSER program of a sign-in (BTN-1292)', () => {
  it('hands the link over whole, its & and %XX kept, and opens nothing', async () => {
    browser = openLoginBrowser()
    call(browser.program, LINK)
    expect(await browser.links()).toEqual([LINK])
  })

  it('reports each new link once while watched', async () => {
    browser = openLoginBrowser()
    const seen = vi.fn()
    const stop = browser.watch(seen, 20)
    call(browser.program, LINK)
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith(LINK))
    await new Promise((done) => setTimeout(done, 60))
    stop()
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('leaves nothing behind once removed', () => {
    const made = openLoginBrowser()
    made.remove()
    expect(existsSync(made.program)).toBe(false)
  })
})

describe('linksOf', () => {
  it('takes the quoted and bare links and drops the rest', () => {
    expect(linksOf(`"${LINK}"\r\nECHO is off.\r\nhttp://localhost:1/x\n\n`)).toEqual([LINK, 'http://localhost:1/x'])
  })
})
