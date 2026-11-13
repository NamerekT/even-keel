import type { EvenKeelState } from '../../../src/state.js'

const LONG_NAME = 'Customer portal with a deliberately long display name'
const LONG_TITLE = ' — с длинным названием, которое переносится на вторую строку в карточке'
const LONG_MODEL = 'openrouter/minimax/minimax-m3.1-flash-with-a-deliberately-long-model-suffix'

const MIXED_NAMES: Record<string, string> = { DEMO: 'Customer portal docs', OPS: LONG_NAME }

/** `?long=mixed`: a row of names in one, two and three lines (ABC and XYZ keep theirs), for the cards' level slots (BTN-1022). */
export function withMixedNames(state: EvenKeelState): EvenKeelState {
  const projects = Object.fromEntries(Object.entries(state.config.projects).map(([id, project]) => [id, { ...project, name: MIXED_NAMES[id] ?? project.name }]))
  return { ...state, config: { ...state.config, projects } }
}

/** `?feeds=two|five`: the empty XYZ files its tasks in two or five trackers, its own and feeds, for the "Open in…" list. */
export function withFeeds(state: EvenKeelState, count: string): EvenKeelState {
  const kinds = count === 'two' ? ['github'] : count === 'five' ? ['github', 'linear', 'gitlab', 'forgejo'] : []
  const feeds = kinds.map((tracker, at) => ({ id: `feed-xyz-${tracker}`, tracker, key: `XYZ${at + 1}` }))
  const pages = Object.fromEntries(feeds.map((feed) => [feed.id, `https://${feed.tracker}.example.com/xyz/issues`]))
  return {
    ...state,
    config: { ...state.config, feeds: { ...state.config.feeds, XYZ: feeds } },
    trackerUrls: { ...state.trackerUrls, pages: { ...state.trackerUrls.pages, ...pages } },
  }
}

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
