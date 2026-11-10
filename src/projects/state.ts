import type { Notice } from '../notice/notice.js'
import type { RepoBranches } from './branch.js'

/** A project the wizard of `/projects/add` is about to add; blank text — not given. */
export interface ProjectDraft {
  repo: string
  /** Blank — not chosen yet: the check suggests the checkout's current branch. */
  branch: string
  key: string
  name: string
  tracker: string
  trackerProject: string
  /** The tracker's profile the project runs on (`ProfileView.id`); `null` — the tracker's default profile. */
  profile: string | null
  /** Slots of the pool; `0` — a worktree per task. */
  slot: number
  /**
   * The only milestones the project takes (`chain.requiredMilestones`): a second project on one tracker project splits
   * it by them, and the projects already on it give them up (BTN-306).
   */
  milestones: string[]
  /** The agent the project's sessions run on (BTN-310); `null` — the shared provider. */
  provider: string | null
  /**
   * `false` — a project without git (BTN-883): `repo` may be blank (Even Keel makes a folder in its data folder) or
   * name a folder that is no repository or does not exist yet; `branch` and `slot` are not read.
   */
  git?: boolean
}

/** What the wizard's check found for a draft; a step that could not be checked yet is `null`. */
export interface ProjectCheck {
  repo: {
    /** The top of the repository the folder is in, as the entry will name it; `null` — not a git repository. */
    root: string | null
    /** The branch the checkout is on, the suggestion for the main branch; `null` — detached or not a repository. */
    current: string | null
    /** The draft tracker's project its remotes suggest (GitHub: `owner/name` of a github.com remote); `null` — none. */
    suggested: string | null
    /** What the branch field offers and what adding does to the checkout (BTN-754); `null` — not read: no repository, or one another project has. */
    branches: RepoBranches | null
    notice: Notice | null
  }
  /** What `parseConfig` says of the config with the draft added; `null` — it parses. */
  entry: Notice | null
  /** The projects (`projectLabel`) on the draft's tracker project whose chains give up the draft's milestones once it is added. */
  yields: string[]
  /** Asked once the entry parses. */
  tracker: {
    ok: boolean
    /** The tracker's variables, when none of them is set. */
    missing: string[]
    /** Open tasks of the project in the tracker. */
    open: number | null
    /** Anyone can open a task in the tracker's project (a public GitHub repository) and no label is needed to enter the chain. */
    openToAll: boolean
    notice: Notice | null
  } | null
  /**
   * Whether Claude Code trusts the folder; `null` — no repository to ask about, or Claude never runs the project's
   * sessions: it is not the project's agent and run labels are off.
   */
  trusted: boolean | null
  /** The platform of the service's machine (`process.platform`), which the folder is on: the trust command depends on it. */
  platform: string
  /** The user the service runs as: the trust is given in a terminal of theirs, or it lands in another profile (BTN-310). */
  user: string
  /**
   * Even Keel runs as a system service, whose user may not be the one at the terminal: the page then adds the command
   * from another user's terminal (BTN-687). `npm start` and the tray run as that user.
   */
  service: boolean
}

/** Claude Code's trust in a project's checkout, for its settings (`project/trust`, BTN-429). */
export interface ProjectTrust {
  folder: string
  trusted: boolean
  platform: string
  user: string
  /** As `ProjectCheck.service`. */
  service: boolean
}
