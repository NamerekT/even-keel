import type { hotkeysRu } from './hotkeys-ru.js'

/** The hotkeys window (BTN-880). */
export const hotkeysEn: typeof hotkeysRu = {
  title: 'Hotkeys',
  lead: 'The keys of this browser. Another browser, a private window or another address of the page has its own.',
  actions: {
    chainRun: 'Start the chain or resume it',
  },
  tips: {
    chainRun: "On a project's page, the same as the button in its head. A running chain is never stopped or restarted.",
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
  },
}
