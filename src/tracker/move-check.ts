import type { StatusMoves } from '../chain/moves.js'
import type { EvenKeelConfig, Feed } from '../config.js'

/** A task source whose own status moves a config change set anew: a project's main tracker (`feed` undefined) or a feed. */
export interface ChangedMoves {
  project: string
  feed: Feed | undefined
  moves: StatusMoves
}

type MovesConfig = Pick<EvenKeelConfig, 'moves' | 'feeds'>

/**
 * The sources whose status moves differ after a config change (BTN-667): a `config-import` writes them past the page's
 * check, so the service checks them against the tracker's statuses once they apply. Dropped moves are left out.
 */
export function changedMoves(before: MovesConfig, after: MovesConfig): ChangedMoves[] {
  const same = (a: StatusMoves | undefined, b: StatusMoves | undefined) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})
  const main = Object.entries(after.moves)
    .filter(([project, moves]) => !same(before.moves[project], moves))
    .map(([project, moves]): ChangedMoves => ({ project, feed: undefined, moves }))
  const feeds = Object.entries(after.feeds).flatMap(([project, list]) =>
    list
      .filter((feed) => feed.moves !== undefined && !same(before.feeds[project]?.find((each) => each.id === feed.id)?.moves, feed.moves))
      .map((feed): ChangedMoves => ({ project, feed, moves: feed.moves! })),
  )
  return [...main, ...feeds]
}
