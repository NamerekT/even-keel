import type { Messages } from './ru.js'

export const profilesEn: Messages['profiles'] = {
    title: 'Tracker and CI profiles',
    hint: "A project runs on a profile of its tracker. The default tracker profile also goes to sessions started by hand (the env of ~/.claude/settings.json) and to the GitHub Actions CI of other trackers' projects. A Forgejo CI takes the Forgejo profile on its remote's host.",
    none: "No profiles: without one the chain does not read the tracker's tasks.",
    add: 'Add profile',
    isDefault: 'default',
    makeDefault: 'Make default',
    edit: 'Edit',
    rules: 'Rules',
    remove: 'Remove',
    states: { unchecked: 'not checked', checking: 'checking', ok: 'signed in', refused: 'refused', unreachable: 'no answer' },
    expires: (days) => (days <= 0 ? 'token expired' : `expires in ${days} d`),
    login: (login) => `Signed in as ${login}`,
    projects: (keys) => `Projects: ${keys}`,
    noProjects: 'No projects on it',
    ci: (remotes) => `CI: ${remotes}`,
    noCi: "No project's remote is on its host",
    ciHidden: 'CI hidden',
    hiddenCi: (remotes, kind) =>
      kind === 'forgejo'
        ? `Forgejo CI not shown (${remotes}): the token does not see the repository or its Actions, it needs read:repository`
        : kind === 'gitlab'
          ? `GitLab CI not shown (${remotes}): the token does not reach the project's pipelines, check its api scope and project access`
        : `GitHub Actions not shown (${remotes}): the token does not reach the repository's Actions, it needs Actions: Read`,
    kindHint: { huly: 'An own Huly server or the cloud', github: 'Issues and Actions on github.com', linear: 'A Linear workspace', gitlab: 'Issues and CI on GitLab.com or your own server', forgejo: 'The CI of an own Forgejo server, no tracker' },
    pullsRefused: 'PR refused',
    rulesOf: (name) => `Rules: ${name}`,
    rulesFor: (keys) => `Projects on this profile: ${keys}.`,
    rulesNoProjects: 'No project runs on this profile yet.',
    rulesHint:
      "The rules of the projects on this profile: every tracker names its statuses and labels its own way. A list the profile does not change stays the shared one; a list one row of it changes is the profile's whole, and a project's own goes over it. The project's milestones are set on its Tracker tab and in the shared settings.",
    deniedPulls: (remotes, kind) =>
      kind === 'forgejo'
        ? `A pull request was not opened (${remotes}): the token lacks write:repository`
        : kind === 'gitlab'
          ? `A merge request was not opened (${remotes}): the token lacks the api scope or Developer access to the project`
          : `A pull request was not opened (${remotes}): the token lacks Pull requests: Read and write`,
    rightsIntro: {
      huly: "A separate account with access to the projects: its e-mail and password, or a token if your Huly's account settings have an API tokens page.",
      github: "A fine-grained token for the repositories' owner.",
      linear: 'A personal API key.',
      gitlab: 'A personal access token with the api scope. Leave the address empty for GitLab.com.',
      forgejo: "The server's address and a token. A CI and pull requests take the profile whose host is their remote's.",
    },
    rightsUse: { tracker: 'Tracker', ci: 'CI', pullRequests: 'Pull requests' },
    rights: {
      huly: { tracker: "reading and writing the projects' issues" },
      github: {
        tracker: 'Issues — Read and write',
        ci: 'Actions — Read',
        pullRequests: 'Pull requests — Read and write, Contents — Read, Actions — Read',
      },
      linear: { tracker: 'write access' },
      gitlab: {
        tracker: 'api scope (reading and writing issues)',
        ci: 'api scope, with access to the project and its pipelines',
        pullRequests: 'api scope, Developer access or above (opening a merge request, reading its discussions and the project members)',
      },
      forgejo: {
        ci: 'read:repository (the repositories and their Actions), read:user (the sign-in check)',
        pullRequests: "write:repository (opening a pull request, reading its reviews), read:issue (comments in the pull request's conversation), read:user",
      },
    },
    pushedByGit: "PR mode pushes the branch with git, on the credentials of the account the service runs as, not with this token.",
    howTo: 'Where to get it',
    signIn: 'Sign-in',
    alternative: { HULY_TOKEN: 'Token', HULY_EMAIL: 'E-mail and password' },
    name: 'Profile name',
    nameHint: "Filled in from the tracker's answer; can be changed.",
    kept: 'saved',
    hostLocked: 'Fixed while projects use the profile',
    fieldHints: {
      HULY_URL: 'The address of the Huly server, as you open it in the browser.',
      HULY_WORKSPACE: 'The name of the Huly workspace the projects are in.',
      HULY_TOKEN: 'A token of the Huly account from its settings, instead of the e-mail and password.',
      HULY_EMAIL: 'The e-mail of a separate Huly account that sees the projects.',
      HULY_PASSWORD: 'The password of that Huly account.',
      GITHUB_TOKEN: 'A fine-grained token for the repositories’ owner, with the rights of each use listed above.',
      LINEAR_TOKEN: 'A personal Linear API key with write access.',
      GITLAB_URL: 'The GitLab web address, without /api/v4. Empty means https://gitlab.com.',
      GITLAB_TOKEN: 'A personal access token with the api scope; read_api cannot close issues or post comments.',
      FORGEJO_URL: 'The address of the Forgejo server, as you open it in the browser.',
      FORGEJO_TOKEN: 'An access token with the rights of each use listed above.',
    } as Record<string, string>,
    examples: {
      HULY_URL: 'https://huly.example.com',
      HULY_WORKSPACE: 'example-workspace',
      HULY_EMAIL: 'john.doe@example.com',
      FORGEJO_URL: 'https://forgejo.example.com',
      GITLAB_URL: 'https://gitlab.com',
    } as Record<string, string>,
    check: 'Check',
    checking: 'Checking…',
    duplicate: (name) => `The same account is already in the profile "${name}"`,
    save: 'Save',
    editTitle: (name) => `Profile ${name}`,
    field: 'Profile',
    fieldHint: "The tracker account the project runs on: its tasks, the sessions' comments and the CI token.",
    byDefault: (name) => `${name} (default)`,
}
