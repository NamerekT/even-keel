interface Item {
  id: string
  locked: boolean
}

/** Where in the list a task that will stand right before `before` goes: ahead of the locked blockers shown in front of that task; the end for `null` or a task the list lacks. */
export function landingIndex(blocks: Item[], before: string | null): number {
  let index = before === null ? -1 : blocks.findIndex((block) => block.id === before)
  if (index < 0) return blocks.length
  while (index > 0 && blocks[index - 1]!.locked) index--
  return index
}

const SCREEN_EDGE = 16

/** Scrolls the page so the element is in view under the header; leaves the page alone when it already is. */
export function revealElement(element: Element): void {
  const header = document.querySelector('.header')?.getBoundingClientRect().bottom ?? 0
  const box = element.getBoundingClientRect()
  if (box.top >= header + SCREEN_EDGE && box.bottom <= window.innerHeight - SCREEN_EDGE) return
  element.scrollIntoView({ block: 'center', behavior: stillMotion() ? 'auto' : 'smooth' })
}

export function stillMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
