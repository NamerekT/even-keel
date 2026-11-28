# Several trackers, CI and token permissions

## Several trackers

Each project has its own tracker, and they work at the same time: project A on Huly, project B on GitHub.

A tracker can have several profiles — two Huly workspaces, a personal GitHub token and an organization's — and each project picks one: the **Profile** field when you add it, or in its settings until its first task runs (from then the task IDs are tied to its branches, folders and statistics, so the profile stays).

One profile of each tracker is the default: projects without a choice run on it, it is the one sessions started by hand get, and it gives the GitHub Actions token to projects of other trackers. Making another profile the default does not move a project whose tasks have already run: it stays on the old profile, now as its own choice.

A profile whose token is refused turns red on **Trackers and CI**, and the chains on it pause until it is fixed.

Git is not part of this: pushes go through your own git and its credentials (SSH, the credential manager) unless a profile's token serves the remote ([Even Keel's own git](#even-keels-own-git)). A project on Huly with a remote on GitHub works as is, and its CI is found by the remote.

### Task feeds

A project can take tasks from more than one tracker: its own, plus *task feeds* — say a private Huly project for your own work and the GitHub issues others file. The tasks of all of them make one chain in the one repository.

To add one, in the project's settings, **Tracker** → **Task sources** → **Add a feed**, pick the profile (it names the tracker), the place (a repository, a team — the profile's projects are suggested as you type, as in the wizard) and a key for the ids.

- **Ids.** A task keeps its tracker's id — Huly's, Linear's and Jira's own, GitHub's and GitLab's `<feed key>-<number>` — so each feed's key must give ids no other project or feed gives.
- **Order.** Blockers work only within one tracker; across them it is the order you set, then milestone, priority and number.
- **Closing and reading.** A feed's task is closed in its own tracker. Its session gets the task as text in its prompt, unless a package brings that tracker's MCP server, signed in with the feed's profile.
- **Removing a feed.** A feed whose tasks the chain has run keeps its profile. Once you remove it, its tasks closed recently stay on the page for a week, and the stats keep linking them where they lived.

The **Tracker** tab lists the project's tracker and its feeds as **Task sources**, each with a **Configure** window for its chain rules and milestones: a feed's task is judged by the feed's own rules over its profile's, never the project's, since its statuses and labels are another tracker's.

A feed's tasks go by the chain rules of the first level that sets them: the feed's own, then its profile's, then the shared ones ([Chain rules](chain.md#chain-rules)). A GitHub feed on a public repository needs its label as much as a GitHub project does, so set **Only tasks with labels** on that GitHub profile (its tab under **Chain rules**, or **Rules** on its row in **Trackers and CI**) when the feed's own rules do not set it.

The project wizard warns about a public repository that takes tasks without a label only for the project's own tracker. The band on the project page covers feeds too: it names each public source that takes tasks without a label, and the feed's window says it as well.

## CI and pull requests

The CI is read with a profile too:

- **GitHub Actions** on a `github.com` remote takes the token of the project's GitHub profile, or of the default GitHub profile for a project on another tracker.
- **Forgejo Actions** on a Forgejo remote takes a **Forgejo** profile (**Add profile** → Forgejo: the server's address and an access token) on the remote's host. A Forgejo profile is a tracker profile too: the same token serves the issues once it has `write:issue`.
- **GitLab CI** is found from a root `.gitlab-ci.yml` on `gitlab.com` or on a host a GitLab profile's address names, nested groups included. A host Even Keel does not know is taken for Forgejo until a GitLab profile names it; a Forgejo profile's check against a GitLab server asks you to add a GitLab profile instead. Several GitLab servers on one host: pick the profile in **Check and CI** (below).

Pull requests of PR mode take the same token as the remote's CI. What each token needs is in [Token permissions](#token-permissions).

With several GitHub, Forgejo or GitLab profiles, a project can pick the one its CI and pull requests take in **Settings** → **Check and CI** → **GitHub profile** (or Forgejo, GitLab); **Automatic** is the choice above.

A CI that no profile reaches is not shown at all. CI supports GitHub, Forgejo (or Gitea) and GitLab. PR mode supports GitHub, Forgejo and GitLab (merge requests, on the same profile as the remote's GitLab CI). A remote on `bitbucket.org` has no CI and cannot use PR mode.

## Token permissions

What a profile's token needs, by what it is used for. The profile dialog lists the same for the kind you pick.

| Profile | Tracker | CI | Pull requests (PR mode) |
| --- | --- | --- | --- |
| Huly | a separate account with access to the projects: its e-mail and password, or a token | — | — |
| GitHub, a fine-grained token for the repositories' owner | **Issues: Read and write** | **Actions: Read** | **Pull requests: Read and write**, **Contents: Read**, **Actions: Read** |
| Linear, a personal API key | write access | — | — |
| GitLab, a personal access token | `api` scope (`read_api` cannot close issues or post comments) | `api` scope, with access to the project and its pipelines | `api` scope, Developer access or above in the project (pushing the branch, opening a merge request, reading its discussions and the members) |
| Jira Cloud, an Atlassian API token | Browse projects, Add comments, Transition issues and Edit issues in the projects; a token with scopes also needs `read:jira-work`, `write:jira-work` and `read:jira-user` | — | — |
| Jira plugin, a separate Atlassian MCP V2 token | All scopes of the Atlassian MCP V2 application; enable API token authentication for the Atlassian MCP server before creating it. The REST token cannot be reused | — | — |
| Forgejo, an access token | `write:issue` (issues, their dependencies, comments, labels, milestones); `read:repository` (the repository list and the collaborators); `read:user` (the sign-in check); for an organization's repository also `read:organization`, without which its labels and milestones are not read | `read:repository` (the repositories and their Actions), `read:user` | `write:repository` (opening a pull request, reading its reviews and its reviewers' access), `read:issue` (its conversation), `read:user`; for reviewers other than the account and the repository's owner, the account must be an admin of the repository |

The Forgejo rights for pull requests follow from the API calls Even Keel makes and are not yet checked against a real server ([What has not been verified](../unverified.md)).

### Even Keel's own git

Even Keel's own git — the pushes of task branches and of the main branch, its fetches and the clones of the setup wizard and of machines — takes the token of the remote's GitHub, GitLab or Forgejo profile, the one its CI uses, for each call to an HTTPS remote. To push, the token then needs write access to the repository's contents: GitHub **Contents: Read and write**, GitLab `write_repository` (or `api`) with Developer access, Forgejo `write:repository`.

- A push the forge refuses for a read-only token is tried once more on git's own credentials; refused again, it stops with a message that names the profile and opens it.
- An SSH remote, a plain `http://` one, a remote with no profile and git older than 2.31 go on the git credentials of the account the service runs as (its SSH keys or credential manager).
- Even Keel never force-pushes, so your commits on the forge stay.

### A pull request that cannot be opened

A forge that refuses to open a pull request with the token marks the profile's row **PR refused** and names the right it lacks, and the chain pauses. Fix the token or select a profile with access in the project's **Check and CI** settings, then press **Resume**: Even Keel opens the pull request again from the session's finished turn, without writing to the session. Another failure pauses the chain with its new cause; changing the profile alone does not retry it.

A push refused because the branch on the forge has commits the task's session lacks — you resolved a conflict on the forge, say — does not pause the chain: the session is told to merge the branch from the forge and end its turn for the pull request again.
