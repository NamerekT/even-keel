import type { Activity } from './activity.js'
import type { LiveSource } from './connection.js'

export type LiveActions = { read: LiveSource['query']; deliver: LiveSource['command'] } & Pick<LiveSource, 'retryNow' | 'command' | 'session' | 'transcript' | 'onTranscript' | 'onMachines' | 'checkpoint' | 'imageUrl' | 'sentFileUrl' | 'sharedUrl' | 'badgeUrl' | 'tools' | 'card' | 'vocabulary' | 'checkProject' | 'query' | 'attach' | 'statsHistory' | 'statsPeriod' | 'statsSteps' | 'statsCheckpoints' | 'statsSpend' | 'statsTokens' | 'statsTask' | 'statsRules' | 'statsRuleDiff' | 'statsCompare'>

/**
 * The source with the person's own waits on the top bar (BTN-1257): commands, the session, the card, the project check,
 * queries and files. `read` is a query off the bar, for the values a field offers: the field shows its own loader when
 * opened meanwhile. `deliver` is a command off the bar for the person's chat message: its clock under the message turns
 * instead, for as long as a session takes to start or finish its turn (BTN-1393). Stats, the tracker's vocabulary and the
 * tools' views stay off it too: whatever shows them shows its own reading (the Tools page's skeleton, "What sessions get"'s
 * loader, a field's list).
 */
export function liveActions(source: LiveSource, bar: Activity): LiveActions {
  return {
    retryNow: () => source.retryNow(),
    command: (name, body) => bar.track(source.command(name, body)),
    deliver: (name, body) => source.command(name, body),
    session: (sessionId) => bar.track(source.session(sessionId)),
    transcript: (sessionId, after) => source.transcript(sessionId, after),
    onTranscript: (sessionId, listener) => source.onTranscript(sessionId, listener),
    onMachines: (listener) => source.onMachines(listener),
    checkpoint: (sessionId) => source.checkpoint(sessionId),
    imageUrl: (sessionId, tool, index) => source.imageUrl(sessionId, tool, index),
    sentFileUrl: (sessionId, name) => source.sentFileUrl(sessionId, name),
    sharedUrl: (sessionId, tool, index) => source.sharedUrl(sessionId, tool, index),
    badgeUrl: (project, theme, still) => source.badgeUrl(project, theme, still),
    tools: (project) => source.tools(project),
    card: (task) => bar.track(source.card(task)),
    vocabulary: (projectId) => source.vocabulary(projectId),
    checkProject: (draft, askTracker) => bar.track(source.checkProject(draft, askTracker)),
    query: (name, body, options) => bar.track(source.query(name, body, options)),
    read: (name, body, options) => source.query(name, body, options),
    attach: (task, file) => bar.track(source.attach(task, file)),
    statsHistory: (filter) => source.statsHistory(filter),
    statsPeriod: (query) => source.statsPeriod(query),
    statsSteps: (query) => source.statsSteps(query),
    statsCheckpoints: () => source.statsCheckpoints(),
    statsSpend: (tz) => source.statsSpend(tz),
    statsTokens: (tz) => source.statsTokens(tz),
    statsTask: (task) => source.statsTask(task),
    statsRules: (query) => source.statsRules(query),
    statsRuleDiff: (changes) => source.statsRuleDiff(changes),
    statsCompare: (query) => source.statsCompare(query),
  }
}
