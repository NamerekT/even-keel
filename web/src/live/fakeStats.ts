import type { StatsAnswer, StatsQuery, StatsStuck } from '../../../src/stats/model.js'

function ago(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString()
}

function stuck(id: string, task: string | null, hours: number, kinds: string[], reason: string | null, note: string | null): StatsStuck {
  return { id, task, sessionId: `00000000-0000-4000-8000-${id.padStart(12, '0')}`, fromAt: ago(hours + 0.3), toAt: ago(hours), kinds, reason, note }
}

export function fakeStats(mode: string | null, project: string, query: StatsQuery): StatsAnswer {
  if (mode === 'off') return { state: 'off', reason: 'не заданы TALLY_DB_HOST, TALLY_DB_NAME, TALLY_READER_PASSWORD в .env' }
  if (mode === 'error') return { state: 'error', error: 'connect ETIMEDOUT 100.64.0.1:5432' }
  const scale = (query.days / 7) * (query.scope === 'chain' ? 0.7 : 1)
  const empty = mode === 'empty'
  const tasks = empty
    ? []
    : [
        { task: `${project}-12`, title: 'Перевести сборку на новый планировщик', status: 'Done', cost: 22.86, sessions: 7, sevenDay: 4.1 },
        { task: `${project}-9`, title: 'Склад без лишних полок', status: 'Done', cost: 19.53, sessions: 2, sevenDay: 3.2 },
        { task: `${project}-5`, title: 'Сохранения: переезд на формат 3', status: 'In Progress', cost: 14.55, sessions: 1, sevenDay: null },
        { task: `${project}-7`, title: 'Карта видит только знание игрока', status: 'Done', cost: 12.47, sessions: 3, sevenDay: 1.9 },
        { task: `${project}-3`, title: 'Очередь задач: перетаскивание', status: 'Done', cost: 6.2, sessions: 1, sevenDay: 0.8 },
      ].map((each) => ({ ...each, cost: each.cost * scale }))
  return {
    state: 'ok',
    stats: {
      project,
      query,
      since: ago(query.days * 24),
      at: new Date().toISOString(),
      total: {
        cost: empty ? 0 : 638.03 * scale,
        previousCost: empty ? 0 : 726.12 * scale,
        messages: empty ? 0 : Math.round(11_289 * scale),
        sessions: empty ? 0 : Math.round(190 * scale),
        unpriced: 0,
        fiveHour: empty ? null : 38.5,
        sevenDay: empty ? null : 21.4 * scale,
      },
      service: query.scope === 'chain' || empty ? { cost: 0, sessions: 0 } : { cost: 134.06, sessions: 60 },
      tasks,
      repeats: empty
        ? []
        : [
            { task: `${project}-12`, title: 'Перевести сборку на новый планировщик', status: 'Done', sessions: 7, relays: 0, checkpoints: 6, restarts: 0, spans: 1, rework: false },
            { task: `${project}-7`, title: 'Карта видит только знание игрока', status: 'Done', sessions: 3, relays: 2, checkpoints: 0, restarts: 0, spans: 0, rework: true },
            { task: `${project}-9`, title: 'Склад без лишних полок', status: 'Done', sessions: 2, relays: 0, checkpoints: 0, restarts: 1, spans: 2, rework: false },
          ],
      stuck: empty
        ? []
        : [
            stuck('1', `${project}-9`, 5, ['denied'], 'broken_tooling', 'Агент пытался удалить worktree, команда упала с Permission denied: папку держал процесс dev-сервера.'),
            stuck('2', null, 20, ['failures', 'repeat'], 'debug_loop', 'Сессия трижды запускала один и тот же тест без правки между запусками.'),
            stuck('3', `${project}-12`, 30, ['reread', 'compact'], null, null),
            stuck('4', `${project}-7`, 52, ['no_commit'], 'unclear_task', 'В задаче не сказано, какой формат сохранения считать основным; сессия перебирала оба.'),
          ].filter((each) => query.scope === 'all' || each.task !== null),
      reasons: empty
        ? []
        : [
            { reason: 'broken_tooling', spans: 7 },
            { reason: 'debug_loop', spans: 2 },
            { reason: 'unclear_task', spans: 1 },
            { reason: null, spans: 10 },
          ],
    },
  }
}
