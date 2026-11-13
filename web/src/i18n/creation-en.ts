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
  target: 'Folder or repository address',
  targetHint:
    "The full path of a folder on this machine — with a repository, without one, or not made yet; a repository's address to clone (HTTPS or SSH); or just the name of a new folder in Even Keel's projects folder. A private repository needs git signed in to its server.",
  targetPlaceholder: (platform) => `${platform === 'win32' ? 'C:\\Projects\\my-app' : '~/projects/my-app'} · https://github.com/me/app.git · git@github.com:me/app.git`,
  reads: {
    clone: (host) => `Clone from ${host}`,
    cloneEmpty: 'the repository is empty',
    existing: 'Existing repository',
    noRemote: 'no remote',
    here: 'New repository in this folder',
    empty: 'empty',
    make: 'No such folder — Even Keel makes it and a new repository in it',
    name: 'New folder with a repository',
  },
  takeRoot: 'Use the top',
  folder: 'Folder',
  folderHint: "The folder's name in Even Keel's projects folder. Blank — the one suggested by the address or the project.",
  folderBlank: (clone) => `Type a name, or leave it blank for one named after the ${clone ? 'address' : 'project'}.`,
  folderOtherHint: 'The full path of the folder. A clone needs an empty folder or one that is not there yet.',
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
      connecting: 'connecting',
      enumerating: 'the server lists objects',
      counting: 'counting objects',
      compressing: 'compressing',
      receiving: 'receiving',
      resolving: 'resolving deltas',
      files: 'files',
      lfs: 'LFS files',
    },
    received: (bytes, speed) => `${size(bytes)}${speed === undefined ? '' : ` · ${size(speed)}/s`}`,
    objects: (count) => count.toLocaleString('en'),
    retry: 'Retry',
    cancel: 'Cancel',
    close: 'Close',
    open: 'Open the project',
    undoable: 'Cancel removes what Even Keel has made in the folder so far.',
    kept: 'The project is written already and stays, even if the window is closed.',
  },
}
