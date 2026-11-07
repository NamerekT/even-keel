import type { EvenKeelState } from '../../../src/state.js'

const LONG_NAME = 'Customer portal with a deliberately long display name'
const LONG_TITLE = ' — с длинным названием, которое переносится на вторую строку в карточке'

/** `?long=on`: every project has a long name and every task a long title, for the layout of wrapped lines. */
export function withLongNames(state: EvenKeelState): EvenKeelState {
  const projects = Object.fromEntries(Object.entries(state.config.projects).map(([id, project]) => [id, { ...project, name: LONG_NAME }]))
  return {
    ...state,
    config: { ...state.config, projects },
    tasks: state.tasks.map((task) => ({ ...task, title: task.title + LONG_TITLE })),
  }
}
