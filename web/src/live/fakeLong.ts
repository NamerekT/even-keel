import type { EvenKeelState } from '../../../src/state.js'

const LONG_NAME = 'Customer portal with a deliberately long display name'
const LONG_TITLE = ' — с длинным названием, которое переносится на вторую строку в карточке'
const LONG_MODEL = 'openrouter/minimax/minimax-m3.1-flash-with-a-deliberately-long-model-suffix'

/**
 * `?long=on`: every project has a long name and every task a long title, for the layout of wrapped lines;
 * ABC-5 runs on OpenCode with a long routed model, for the cut of the session's Model fact.
 */
export function withLongNames(state: EvenKeelState): EvenKeelState {
  const projects = Object.fromEntries(Object.entries(state.config.projects).map(([id, project]) => [id, { ...project, name: LONG_NAME }]))
  return {
    ...state,
    config: { ...state.config, projects },
    tasks: state.tasks.map((task) => ({ ...task, title: task.title + LONG_TITLE })),
    sessions: state.sessions.map((session) => session.task === 'ABC-5' ? { ...session, agent: 'opencode', model: LONG_MODEL } : session),
  }
}
