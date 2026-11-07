/** The demo's agent in `AGENTS` and the agent of its account folder (BTN-776): a script, no model, no limits. */
export const DEMO_AGENT = 'demo'
/** The demo's account folder key: never a folder of the user's, the roots list no such name. */
export const DEMO_ACCOUNT = 'even-keel-demo'
/** The demo project's key on the built-in tracker. */
export const DEMO_KEY = 'DEMO'

/** The demo as the page sees it; `null` in the state — there is none. */
export interface DemoView {
  /** The demo project's id. */
  project: string
  /** Every task of the demo project is closed: the page shows the end card. */
  finished: boolean
}
