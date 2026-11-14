import type { TextEdit } from '../tracker/model.js'

/**
 * What an issue says of its text's changes (BTN-1124), for GraphQL: the description's edits, the title's renames and the
 * labels' puttings. The last 50 of each are enough: a label of interest is a recent one.
 */
export const EDITS = `userContentEdits(last: 50) { nodes { editedAt editor { login } } }
  timelineItems(itemTypes: [LABELED_EVENT, RENAMED_TITLE_EVENT], last: 50) {
    nodes { __typename ... on LabeledEvent { createdAt label { name } } ... on RenamedTitleEvent { createdAt actor { login } } }
  }`

export interface GithubEdits {
  author?: { login: string } | null
  userContentEdits?: { nodes: ({ editedAt: string; editor: { login: string } | null } | null)[] } | null
  timelineItems?: { nodes: ({ __typename: string; createdAt?: string; label?: { name: string } | null; actor?: { login: string } | null } | null)[] } | null
}

/**
 * The changes of the issue's text by its author or a deleted account, the only outsiders who can edit it: anyone else
 * who edits an issue has a role in the repository. `undefined` — none.
 */
export function textEditOf(issue: GithubEdits): TextEdit | undefined {
  const author = issue.author?.login.toLowerCase() ?? null
  const outsider = (who: { login: string } | null | undefined) => who == null || author === null || who.login.toLowerCase() === author
  const times: number[] = []
  const labeled: TextEdit['labeled'] = []
  for (const edit of issue.userContentEdits?.nodes ?? []) if (edit !== null && outsider(edit.editor)) times.push(Date.parse(edit.editedAt))
  for (const item of issue.timelineItems?.nodes ?? []) {
    if (item === null || item.createdAt === undefined) continue
    if (item.__typename === 'RenamedTitleEvent' && outsider(item.actor)) times.push(Date.parse(item.createdAt))
    if (item.__typename === 'LabeledEvent' && item.label != null) labeled.push({ label: item.label.name, at: Date.parse(item.createdAt) })
  }
  const known = times.filter((time) => !Number.isNaN(time))
  return known.length === 0 ? undefined : { at: Math.max(...known), labeled }
}
