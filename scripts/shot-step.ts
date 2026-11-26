/** The steps a shot takes before it is taken, shared by `npm run shot` (its options) and `npm run guide-shots` (the manifest). */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'

export interface Step { kind: 'click' | 'context' | 'hover' | 'press' | 'fill' | 'upload' | 'wait' | 'wheel' | 'drag' | 'drop'; arg: string }

export const STEP_KINDS: readonly Step['kind'][] = ['click', 'context', 'hover', 'press', 'fill', 'upload', 'wait', 'wheel', 'drag', 'drop']

export const ROOT = fileURLToPath(new URL('..', import.meta.url))

export async function runStep(page: Page, step: Step): Promise<void> {
  if (step.kind === 'click') await page.locator(step.arg).first().click()
  else if (step.kind === 'context') await page.locator(step.arg).first().click({ button: 'right' })
  else if (step.kind === 'hover') await page.locator(step.arg).first().hover()
  else if (step.kind === 'press') await page.keyboard.press(step.arg)
  else if (step.kind === 'wheel') await page.mouse.wheel(0, Number(step.arg))
  else if (step.kind === 'fill') {
    const at = step.arg.indexOf('=')
    if (at < 0) throw new Error('--fill is SELECTOR=TEXT')
    await page.locator(step.arg.slice(0, at)).first().fill(step.arg.slice(at + 1))
  } else if (step.kind === 'upload') {
    const at = step.arg.indexOf('=')
    if (at < 0) throw new Error('--upload is SELECTOR=PATH[,PATH…]')
    const files = step.arg.slice(at + 1).split(',').map((path) => join(ROOT, path))
    await page.locator(step.arg.slice(0, at)).first().setInputFiles(files)
  } else if (step.kind === 'drag') {
    await page.locator(step.arg).first().hover()
    await page.mouse.down()
  } else if (step.kind === 'drop') await page.mouse.up()
  else if (/^\d+$/.test(step.arg)) await page.waitForTimeout(Number(step.arg))
  else await page.locator(step.arg).first().waitFor()
}
