import type { ImportAuthor, ImportAuthorKind } from '../../../src/tracker/import.js'
import type { ImportAuthorChoice, ImportPlanAuthor } from '../../../src/tracker/import-plan.js'

/** The picks the import window sends with `plan` and `start` (BTN-1416): every author of the plan, as it stands. */
export const authorChoices = (authors: readonly ImportPlanAuthor[]): ImportAuthorChoice[] => authors.map(({ kind, name, as }) => ({ kind, name, as }))

const same = (a: ImportAuthor, b: ImportAuthor) => a.kind === b.kind && a.name === b.name

/** The plan's authors with `author` becoming `as`; the list it got stays as it was. */
export const pickAuthor = (authors: readonly ImportPlanAuthor[], author: ImportAuthor, as: ImportAuthorKind): ImportPlanAuthor[] =>
  authors.map((each) => (same(each, author) ? { ...each, as } : each))

/** What an author can become: a person under their name only where the tracker gives one — without it the import writes the user. */
export const authorKinds = (author: ImportAuthor): ImportAuthorKind[] => (author.name === null ? ['agent', 'user'] : ['agent', 'user', 'person'])
