/**
 * Cheap look at the page for a session: element screenshots plus a text report of layout faults, instead of
 * the Playwright MCP, whose every step returns the page's whole accessibility tree into the context.
 *
 *   npm run shot -- [route] [selector ...] [options]
 *
 * The route (`?chain=ask&card=empty`, `/stats`, `#settings`) goes to an in-process `dev:fake` server on a free
 * port, or to `--url`. Each selector is waited for and shot alone into `.temp/shot/<name>/`; with no selector,
 * the viewport. Options and steps are in `docs/web.md` ("Screenshots").
 */
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'

interface Step { kind: 'click' | 'hover' | 'press' | 'fill' | 'wait'; arg: string }

interface Audit { box: string; spill: string[]; cut: string[]; overlap: string[] }

interface Options {
  route: string
  selectors: string[]
  steps: Step[]
  evals: string[]
  name?: string
  url?: string
  width: number
  height: number
  light: boolean
  full: boolean
  image: boolean
  settle: number
  limit: number
}

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function parse(args: string[]): Options {
  const options: Options = {
    route: '/', selectors: [], steps: [], evals: [], width: 1280, height: 800,
    light: false, full: false, image: true, settle: 500, limit: 8,
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    const value = (): string => {
      const next = args[++i]
      if (next === undefined) throw new Error(`${arg} needs a value`)
      return next
    }
    if (arg === '--name') options.name = value()
    else if (arg === '--url') options.url = value().replace(/\/$/, '')
    else if (arg === '--size') {
      const [width, height] = value().split('x').map(Number)
      if (!width || !height) throw new Error('--size is WIDTHxHEIGHT')
      options.width = width
      options.height = height
    } else if (arg === '--light') options.light = true
    else if (arg === '--full') options.full = true
    else if (arg === '--no-image') options.image = false
    else if (arg === '--settle') options.settle = Number(value())
    else if (arg === '--limit') options.limit = Number(value())
    else if (arg === '--eval') options.evals.push(value())
    else if (['--click', '--hover', '--press', '--fill', '--wait'].includes(arg)) {
      options.steps.push({ kind: arg.slice(2) as Step['kind'], arg: value() })
    } else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`)
    else if (/^[?/#]/.test(arg) && options.selectors.length === 0 && options.route === '/') options.route = arg
    else options.selectors.push(arg)
  }
  return options
}

const slug = (text: string): string => text.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase()

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch()
  } catch {
    try {
      return await chromium.launch({ channel: 'chrome' })
    } catch {
      throw new Error('no browser: run `npx playwright install chromium` (or install Google Chrome)')
    }
  }
}

async function fakeServer(): Promise<{ server: ViteDevServer; base: string }> {
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

async function run(page: Page, step: Step): Promise<void> {
  if (step.kind === 'click') await page.locator(step.arg).first().click()
  else if (step.kind === 'hover') await page.locator(step.arg).first().hover()
  else if (step.kind === 'press') await page.keyboard.press(step.arg)
  else if (step.kind === 'fill') {
    const at = step.arg.indexOf('=')
    if (at < 0) throw new Error('--fill is SELECTOR=TEXT')
    await page.locator(step.arg.slice(0, at)).first().fill(step.arg.slice(at + 1))
  } else if (/^\d+$/.test(step.arg)) await page.waitForTimeout(Number(step.arg))
  else await page.locator(step.arg).first().waitFor()
}

function print(title: string, lines: string[]): void {
  for (const line of lines) console.log(`  ${title}: ${line}`)
}

async function main(): Promise<number> {
  const options = parse(process.argv.slice(2))
  const name = options.name ?? (slug(options.route) || 'page')
  const dir = join(ROOT, '.temp/shot', name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  const fake = options.url ? undefined : await fakeServer()
  const browser = await launch()
  let faults = 0
  try {
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      colorScheme: options.light ? 'light' : 'dark',
    })
    context.setDefaultTimeout(5000)
    await context.addInitScript({ path: join(ROOT, 'scripts/shot.page.js') })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })

    const url = (options.url ?? fake!.base) + (options.route.startsWith('/') ? '' : '/') + options.route
    await page.goto(url)
    for (const step of options.steps) await run(page, step)
    await page.waitForTimeout(options.settle)
    console.log(`${url}  ${options.light ? 'light' : 'dark'} ${options.width}x${options.height}`)

    const targets = options.selectors.length > 0 ? options.selectors : [':root']
    for (const [index, selector] of targets.entries()) {
      const locator = page.locator(selector)
      await locator.first().waitFor({ timeout: 5000 }).catch(() => undefined)
      const count = await locator.count()
      if (count === 0) {
        console.log(`${selector}  not found`)
        faults++
        continue
      }
      const first = locator.first()
      const audit = await first.evaluate(
        (el, limit) => (window as unknown as { __shot: { audit(el: Element, limit: number): Audit } }).__shot.audit(el, limit),
        options.limit,
      )
      let file = ''
      if (options.image) {
        file = join('.temp/shot', name, options.selectors.length > 0 ? `${index + 1}-${slug(selector)}.png` : 'page.png')
        const path = join(ROOT, file)
        if (options.selectors.length > 0) await first.screenshot({ path, animations: 'disabled' })
        else await page.screenshot({ path, fullPage: options.full, animations: 'disabled' })
      }
      console.log(`${selector}  ×${count}  ${audit.box}  ${file.replaceAll('\\', '/')}`)
      print('spill', audit.spill)
      print('cut', audit.cut)
      print('overlap', audit.overlap)
    }
    for (const expression of options.evals) {
      const value: unknown = await page.evaluate(expression)
      console.log(`eval ${expression}  =>  ${JSON.stringify(value)}`)
    }
    if (errors.length > 0) {
      faults += errors.length
      print('console', errors.slice(0, options.limit))
    }
  } finally {
    await browser.close()
    await fake?.server.close()
  }
  return faults > 0 ? 1 : 0
}

main().then((code) => process.exit(code), (error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(2)
})
