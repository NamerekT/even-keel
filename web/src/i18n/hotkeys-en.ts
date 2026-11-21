import type { hotkeysRu } from './hotkeys-ru.js'

/** The hotkeys window (BTN-880). */
export const hotkeysEn: typeof hotkeysRu = {
  title: 'Hotkeys',
  lead: 'The keys of this browser. Another browser, a private window or another address of the page has its own.',
  actions: {
    chainRun: 'Start the chain or resume it',
    chatTask: 'Task panel in the chat',
  },
  tips: {
    chainRun: "On a project's page, the same as the button in its head. A running chain is never stopped or restarted.",
    chatTask: "In the chat window, opens and closes the task's description, attachments and comments at the left; works in the reply field too. On a phone it opens the task card.",
  },
  draft: {
    save: 'Save',
    undo: 'Undo a field’s edit',
    redo: 'Redo the edit',
  },
  draftTips: {
    save: 'In the settings and the tracker window, the same as the “Save” button; works in a text field too. Does nothing when nothing changed.',
    undo: 'In the settings and the tracker window, steps back the last changed field of the open section while the changes are not saved. In a text field it undoes the typing, as usual.',
    redo: 'Brings back the edit an undo stepped back. A new edit after the undo drops it.',
  },
  doubleClick: 'Double click on a task — its card',
  fixed: 'fixed',
  change: 'Change',
  cancel: 'Cancel',
  recording: 'Press a combination…',
  recordingTip: 'Esc cancels',
  reset: 'Default',
  resetAll: 'Reset all',
  refusal: {
    bare: 'Needs a modifier: without one only F1–F12 will do.',
    reserved: (combo: string) => `The browser keeps ${combo} for itself and never hands it to the page.`,
    taken: (action: string) => `Already taken: “${action}”.`,
    field: 'Enter in the chat window sends and breaks lines: pick another key.',
  },
}
