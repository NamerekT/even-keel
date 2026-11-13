// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskCard as Card } from '../../../src/tracker/card.js'
import { TitleEdit } from './CardFields.js'
import type { CardEditor, EditOutcome } from './useCardEdit.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const cardOf = (title: string) => ({ id: 'DEMO-1', title }) as Card

/** An editor whose `edit` answers only when the test says so. */
function editorOf() {
  let answer: (outcome: EditOutcome) => void = () => {}
  const edit = vi.fn<CardEditor['edit']>(() => new Promise<EditOutcome>((resolve) => (answer = resolve)))
  const editor = { project: 'project-guid', busy: false, edit } as unknown as CardEditor
  return { editor, edit, answer: (outcome: EditOutcome) => act(async () => answer(outcome)) }
}

let root: Root
let host: HTMLElement
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ''
  localStorage.clear()
})

async function render(card: Card, editor: CardEditor) {
  if (host === undefined || !host.isConnected) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  }
  await act(async () => root.render(createElement(TitleEdit, { card, editor })))
}

const shown = () => host.querySelector('.task-card__title-edit')?.textContent ?? null

async function type(text: string) {
  await act(async () => host.querySelector<HTMLButtonElement>('.task-card__title-edit')!.click())
  const input = host.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
}

const leave = (input: HTMLInputElement) => act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))

describe("the title of a built-in task's card (BTN-1111)", () => {
  it('shows what was typed from the moment the field is left until the card is read anew', async () => {
    const { editor, edit, answer } = editorOf()
    await render(cardOf('Old title'), editor)
    await leave(await type('New title'))

    expect(edit).toHaveBeenCalledWith('title', 'Old title', 'New title', expect.objectContaining({ kept: true }))
    expect(shown()).toBe('New title')

    await answer('landed')
    expect(shown()).toBe('New title')

    await render(cardOf('New title'), editor)
    expect(shown()).toBe('New title')
  })

  it('goes back to the old title when the service refuses the edit', async () => {
    const { editor, answer } = editorOf()
    await render(cardOf('Old title'), editor)
    await leave(await type('New title'))
    await answer('refused')
    expect(shown()).toBe('Old title')
  })

  it('goes back to the old title on a conflict, which keeps the draft in its own dialog', async () => {
    const { editor, answer } = editorOf()
    await render(cardOf('Old title'), editor)
    await leave(await type('New title'))
    await answer('conflict')
    expect(shown()).toBe('Old title')
  })

  it('follows a title somebody else set after the edit landed', async () => {
    const { editor, answer } = editorOf()
    await render(cardOf('Old title'), editor)
    await leave(await type('New title'))
    await answer('landed')
    await render(cardOf('Their title'), editor)
    expect(shown()).toBe('Their title')
  })

  it('drops the edit on Escape', async () => {
    const { editor, edit } = editorOf()
    await render(cardOf('Old title'), editor)
    const input = await type('New title')
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(shown()).toBe('Old title')
    expect(edit).not.toHaveBeenCalled()
  })

  it('shows a draft left by a closed tab while it is sent again', async () => {
    localStorage.setItem('even-keel.draft.project-guid.DEMO-1.title', JSON.stringify({ from: 'Old title', to: 'Left title' }))
    const { editor, edit } = editorOf()
    await render(cardOf('Old title'), editor)
    expect(edit).toHaveBeenCalledWith('title', 'Old title', 'Left title', expect.objectContaining({ kept: true }))
    expect(shown()).toBe('Left title')
  })
})
