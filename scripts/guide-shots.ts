/**
 * Shoots the guide's frames from `docs/guide/images/shots.json` into `docs/guide/images/<id>.webp`.
 *
 *   npm run guide-shots [-- <id> ...]
 *
 * Every frame, or the ones named. The page is `dev:fake` in process, as for `npm run shot`, with the clock, the time zone,
 * the language and `Math.random` fixed, so a run without interface changes rewrites no file. `docs/web/screenshots.md`,
 * "The guide's frames".
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser } from 'playwright'
import { IMAGES, readManifest, type Frame } from './guide-shots-manifest.ts'
import { fakeServer, launch } from './shot-browser.ts'
import { ROOT, runStep } from './shot-step.ts'

/** The moment every frame is shot at: the fake data's relative times ("5 min ago") read the same on every run. */
const FIXED_TIME = new Date('2026-06-15T10:00:00Z')
const STILL_TRIES = 20
const STILL_GAP_MS = 300
/**
 * Every animation and transition runs once and at once: an endless one (the CI tab's blinking dot) sometimes put its box
 * on a layer of its own, and the rounded corner beside it was drawn with other edge pixels. The end events still fire.
 */
const STILL_CSS = '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition-duration: 0s !important; transition-delay: 0s !important }'

type Outcome = 'same' | 'changed' | 'new'

async function shoot(browser: Browser, base: string, frame: Frame): Promise<{ bytes: Buffer; errors: string[] }> {
  const context = await browser.newContext({
    viewport: { width: frame.width, height: frame.height },
    colorScheme: frame.theme,
    deviceScaleFactor: frame.scale,
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
  })
  try {
    context.setDefaultTimeout(5000)
    await context.addInitScript({ path: join(ROOT, 'scripts/guide-shots.page.js') })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    await page.clock.setFixedTime(FIXED_TIME)
    await page.goto(base + (frame.route.startsWith('/') ? '' : '/') + frame.route, { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: STILL_CSS })
    for (const step of frame.steps) await runStep(page, step)
    if (frame.selector) await page.locator(frame.selector).first().waitFor()
    await page.waitForTimeout(frame.settle)
    const take = (): Promise<Buffer> => frame.selector
      ? page.locator(frame.selector).first().screenshot({ animations: 'disabled', caret: 'hide' })
      : page.screenshot({ animations: 'disabled', caret: 'hide' })
    // Panels that load late and the fake's own timers change the page for a while: the frame is the first shot that
    // the next one repeats.
    let png = await take()
    for (let tries = 0; ; tries++) {
      if (tries === STILL_TRIES) throw new Error(`${frame.id}: the page did not stand still in ${STILL_TRIES} shots`)
      await page.waitForTimeout(STILL_GAP_MS)
      const next = await take()
      if (next.equals(png)) break
      png = next
    }
    const crop = frame.crop && {
      x: Math.round(frame.crop.x * frame.scale), y: Math.round(frame.crop.y * frame.scale),
      width: Math.round(frame.crop.width * frame.scale), height: Math.round(frame.crop.height * frame.scale),
    }
    const webp = await page.evaluate(
      ([data, part, quality]) => (window as unknown as { __guide: { webp(png: string, crop: unknown, quality: number): Promise<string> } }).__guide.webp(data, part, quality),
      [png.toString('base64'), crop ?? null, frame.quality] as const,
    )
    return { bytes: Buffer.from(webp, 'base64'), errors }
  } finally {
    await context.close()
  }
}

function save(path: string, bytes: Buffer): Outcome {
  let old: Buffer | undefined
  try {
    old = readFileSync(path)
  } catch {
    old = undefined
  }
  if (old?.equals(bytes)) return 'same'
  writeFileSync(path, bytes)
  return old ? 'changed' : 'new'
}

async function main(): Promise<number> {
  const frames = readManifest(ROOT)
  const wanted = process.argv.slice(2)
  const unknown = wanted.filter((id) => !frames.some((frame) => frame.id === id))
  if (unknown.length > 0) throw new Error(`no such frame: ${unknown.join(', ')}; the frames are ${frames.map((frame) => frame.id).join(', ')}`)
  const chosen = wanted.length > 0 ? frames.filter((frame) => wanted.includes(frame.id)) : frames

  const fake = await fakeServer()
  // Subpixel text follows how the page happens to be split into layers, so one run in a few drew other fringes.
  const browser = await launch(['--disable-lcd-text'])
  let faults = 0
  try {
    for (const frame of chosen) {
      const file = `${IMAGES}/${frame.id}.webp`
      const { bytes, errors } = await shoot(browser, fake.base, frame)
      if (errors.length > 0) {
        faults++
        console.log(`${frame.id}  not saved: the page logged errors`)
        for (const error of errors.slice(0, 8)) console.log(`  console: ${error}`)
        continue
      }
      console.log(`${frame.id}  ${save(join(ROOT, file), bytes)}  ${(bytes.length / 1024).toFixed(1)} KB  ${file}`)
    }
  } finally {
    await browser.close()
    await fake.server.close()
  }
  return faults > 0 ? 1 : 0
}

main().then((code) => process.exit(code), (error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(2)
})
