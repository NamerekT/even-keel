# Several trackers, CI and token permissions

## Several trackers

Each project has its own tracker (`tracker` in the project's entry, GitHub when a file you write names none), and they work at the same time: project A on Huly, project B on GitHub.

A tracker can have several profiles — two Huly workspaces, a personal GitHub token and an organization's — and each project picks one (the **Profile** field when you add it, or in its settings until its first task runs).

One profile of each tracker is the default: projects without a choice run on it, it is the one sessions started by hand get, and it gives the GitHub Actions token to projects of other trackers.

Making another profile the default does not move a project whose tasks have already run: it stays on the old profile, now as its own choice.

A profile whose token is refused turns red on **Trackers and CI**, and the chains on it pause until it is fixed.

Git is not part of this: pushes go through your own git and its credentials (SSH, the credential manager), whatever the profiles are. A project on Huly with a remote on GitHub works as is, and its CI is found by the remote.

A project can take tasks from a second tracker too: in the project's settings, **Tracker** → **Task feeds** → **Add a feed**, pick the profile (it names the tracker), the place (a repository, a team — the profile's projects are suggested as you type, as in the wizard) and a key for the ids ([Several trackers for one project](trackers.md#several-trackers-for-one-project)).

The chain rules a feed's tasks go by are the project's own, then its profile's, then the shared ones: a GitHub feed on a public repository needs its label as much as a GitHub project does, so set `requiredLabels` on that GitHub profile (its tab under **Chain rules**, or **Rules** on its row in **Trackers and CI**) when the project's own rules do not set it.

The wizard's warning does not cover feeds, but the project page's band does: it names each public source that takes tasks without a label, the feeds included, and the feed's window says it too.

## CI and pull requests

The CI is read with a profile too.

GitLab CI is found from a root `.gitlab-ci.yml` file on `gitlab.com` or a host named by a GitLab profile's address.

Nested groups are supported. When several GitLab installations share a host, HTTP(S) remotes use the longest matching URL prefix from the profiles, falling back to a root profile.

The token comes from the project's GitLab profile for that installation, otherwise its default profile, otherwise its first profile. A profile for another installation on the same host is excluded, even when explicitly chosen.

SSH remotes have no installation prefix in their path: the first installation on the host is used, with a log entry when the choice is ambiguous.

GitHub Actions on a `github.com` remote takes the token of the project's GitHub profile, or of the default GitHub profile for a project on another tracker.

CI on a Forgejo remote takes a **Forgejo** profile (**Add profile** → Forgejo: the server's address and an access token) on the remote's host.

Pull requests of PR mode take the same token as the remote's CI. What each token needs is in [Token permissions](#token-permissions).

With several GitHub, Forgejo or GitLab profiles, a project can pick the one its CI and pull requests take in **Settings** → **Check and CI** (`remoteProfiles`); "Automatic" is the choice above.

A CI that no profile reaches is not shown at all. CI supports GitHub, Forgejo (or Gitea) and GitLab. PR mode supports GitHub, Forgejo and GitLab (merge requests, on the same profile as the remote's GitLab CI). A remote on `bitbucket.org` has no CI and cannot use PR mode.

An unknown host is taken for Forgejo until a GitLab profile identifies it; a Forgejo profile's check on GitLab asks you to add a GitLab profile instead.

A `FORGEJO_TOKEN` left in `.env` from an older install becomes a Forgejo profile on the first start, one per host — that of `FORGEJO_URL` if `.env` has it, and those of the projects' Forgejo remotes; after that it is not read.

A Forgejo profile is a tracker profile too: the same token serves the issues once it has `write:issue`.

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
| Forgejo, an access token | `write:issue` (reading issues and their dependencies, comments, closing, labels and milestones), `read:repository` (the repository list and the collaborators), `read:user` (the sign-in check); for an organization's repository also `read:organization` (the organization's labels), without which the project page says that its labels and milestones are not read | `read:repository` (the repositories and their Actions), `read:user` (the sign-in check) | `write:repository` (opening a pull request, reading its reviews and its reviewers' access), `read:issue` (comments in its conversation), `read:user`; for reviewers other than the account and the repository's owner the account must be an admin of the repository |

Even Keel's own git — the pushes of task branches and of the main branch, its fetches and the clones of the setup wizard and of machines — takes the token of the remote's GitHub, GitLab or Forgejo profile for each call to an HTTPS remote, the profile its CI uses. To push, the token then needs write access to the repository's contents: GitHub **Contents: Read and write**, GitLab `write_repository` (or `api`) with Developer access, Forgejo `write:repository`. A push the forge refuses for a read-only token is tried once more on git's own credentials; refused again, it stops with a message that names the profile and opens it. An SSH remote, a plain `http://` one and a remote with no profile go on the git credentials of the account the service runs as (its SSH keys or credential manager), as before; so does git older than 2.31.

A forge that refuses to open a pull request with the token marks the profile's row **PR refused** and names the right it lacks.

If the chain pauses because a pull request could not be opened, fix the token or select a profile with access in the project's **Check and CI** settings, then press **Resume**.

Even Keel retries the same pull request mark without sending anything to the task's session; another failure pauses the chain with its new cause. Changing the profile alone does not retry it.

A push refused because the branch on the forge has commits the task's session lacks — you resolved a conflict on the forge, say — does not pause the chain: the session is told to merge the branch from the forge and mark the pull request again.

Even Keel never force-pushes, so your commits on the forge stay.

The Forgejo rights for pull requests follow from the API calls Even Keel makes and are not yet checked against a real server ([What has not been verified](../unverified.md)).
