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
