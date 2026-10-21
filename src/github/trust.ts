/**
 * Whose text on GitHub reaches a session: anyone can comment on a public repository, so only the repository's owner,
 * the members of its organization, its collaborators and the token's own account are read. `association` is GitHub's
 * `authorAssociation` (REST: `author_association`); `viewer` — the token's login, `null` when not known.
 */
export function trustedAuthor(association: string | null | undefined, login: string | null | undefined, viewer: string | null): boolean {
  if (association !== null && association !== undefined && TRUSTED.has(association)) return true
  return viewer !== null && login != null && login.toLowerCase() === viewer.toLowerCase()
}

const TRUSTED: ReadonlySet<string> = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

/** The service log's line for each skipped comment, once: the tracker and the pull requests are polled again and again. */
export class Skipped {
  private readonly seen = new Set<string>()

  constructor(private readonly log: (line: string) => void) {}

  note(key: string, line: string): void {
    if (this.seen.has(key)) return
    this.seen.add(key)
    this.log(line)
  }
}
