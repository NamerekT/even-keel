import { plural } from './plural.js'
import type { Messages } from './ru.js'

const size = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
const files = (count: number) => `${count} ${plural('en', count, { one: 'file', other: 'files' })}`

export const creationEn: Messages['creation'] = {
  source: 'Source',
  sources: { clone: 'Clone', new: 'New repository', existing: 'Existing' },
  sourceHints: {
    clone: 'Even Keel clones the repository from its remote into a folder on this machine.',
    new: 'The folder becomes a git repository, and all it holds goes into the first commit.',
    existing: 'A clone that is on this machine already.',
  },
  remote: 'Remote address',
  remoteHint: "The address this machine's git clones the repository from: HTTPS or SSH. A private repository needs git signed in to that server.",
  remotePlaceholder: 'https://github.com/owner/storefront.git',
  remoteRead: (branch) => (branch === null ? 'The remote answered: the repository is empty' : 'The remote answered'),
  folder: 'Folder',
  folderHint: "The folder's name in Even Keel's projects folder. Blank — the one suggested by the address or the project.",
  folderOtherHint: 'The full path of the folder. A clone needs an empty folder or one that is not there yet.',
  folderOtherHintNew: 'The full path of the folder. It need not exist: Even Keel makes it.',
  folderOtherHintPlain: 'The full path of the folder. It need not exist: Even Keel makes it; it may hold files.',
  folderOtherPlaceholder: 'Full path',
  other: 'another folder…',
  own: "into Even Keel's projects folder",
  states: {
    free: 'free — Even Keel makes it',
    empty: 'empty',
    filled: 'the folder holds files already — sessions will work with them',
  },
  firstCommit: (count, bytes, capped) => `The folder holds ${capped ? 'more than ' : ''}${files(count)}, ${size(bytes)} — all of it goes into the first commit`,
  cloneThere: (path) => `Even Keel's projects folder has a clone of this remote on this branch already: ${path}`,
  takeIt: 'Use it',
  gitMissing: "Git does not start on Even Keel's machine: a project in a git repository is not available.",
  noIdentity: 'Git has no name and e-mail for commits: a clone and a new repository are not available.',
  gitSetup: 'Set up git',
  window: {
    title: 'Creating the project',
    steps: {
      folder: 'Folder',
      clone: 'Clone',
      lfs: 'LFS files',
      init: 'First commit',
      project: 'Project entry',
      trust: 'Claude Code trust',
      packages: "Project's packages",
    },
    states: { waiting: 'waiting', running: 'running', done: 'done', failed: 'failed' },
    stages: {
      counting: 'counting objects',
      compressing: 'compressing',
      receiving: 'receiving',
      resolving: 'resolving deltas',
      files: 'files',
      lfs: 'LFS files',
    },
    received: (bytes, speed) => `${size(bytes)}${speed === undefined ? '' : ` · ${size(speed)}/s`}`,
    retry: 'Retry',
    cancel: 'Cancel',
    close: 'Close',
    open: 'Open the project',
    undoable: 'Cancel removes what Even Keel has made in the folder so far.',
    kept: 'The project is written already and stays, even if the window is closed.',
  },
}
