import type { CiTarget } from '../ci/remote.js'
import type { CiRemote } from '../state.js'

/** The profile and its token a project's remote takes now (`ciTokenOf`); `null` — none, or PR mode is off. */
export type CurrentToken = (project: string, target: CiTarget) => { profile: string; token: string } | null

/**
 * The pull requests a forge refused to open (`review.denied`), by project, for the profile's card (EKR-9). A refusal
 * holds while its project still takes the same token from the profile: a new token, another profile or PR mode off
 * drop it, as does the next pull request that opens.
 */
export class PullRefusals {
  private readonly refused = new Map<string, { target: CiTarget; token: string }>()

  note(project: string, target: CiTarget, token: string): void {
    this.refused.set(project, { target, token })
  }

  clear(project: string): void {
    this.refused.delete(project)
  }

  of(profile: string, current: CurrentToken): CiRemote[] {
    return [...this.refused].flatMap(([project, { target, token }]) => {
      const now = current(project, target)
      return now?.profile === profile && now.token === token ? [{ project, remote: target.remote }] : []
    })
  }
}
