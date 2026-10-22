import type { EvenKeelState } from '../../../src/state.js'
import { UPDATE_STEPS, type UpdateBlock, type UpdateResultView, type UpdateStep } from '../../../src/updates/model.js'
import type { ReleaseNote, UpdatesView } from '../../../src/updates/release.js'

const INSTALLED = '0.1.0'
const BLOCKS: readonly UpdateBlock[] = ['service', 'git', 'dirty', 'tag', 'checking']

const BODY = `## What's new

- The update window: the notes of every newer release, **Update** and **Revert**.
- Chains wait for a launch to finish before the service stops.

## Fixes

- The [page](https://example.com/) reloads after a restart.`

const REVERTED = `

### Reverted

- The new storage cache of 0.1.1: it lost answers after a restart.`

function note(version: string, reverted: boolean): ReleaseNote {
  return {
    version,
    tag: `v${version}`,
    url: `https://github.com/example/even-keel/releases/tag/v${version}`,
    body: reverted ? BODY + REVERTED : BODY,
    reverted: reverted ? '- The new storage cache of 0.1.1: it lost answers after a restart.' : null,
  }
}

function result(kind: string | null, previous: string): UpdateResultView | null {
  if (kind === null) return null
  const step: UpdateStep | null = kind === 'done' ? null : UPDATE_STEPS.includes(kind as UpdateStep) ? (kind as UpdateStep) : 'build'
  const rollback = kind === 'done' ? 'none' : kind === 'rollback' ? 'failed' : 'done'
  return {
    mode: 'update',
    from: previous,
    to: '0.2.0',
    at: '2026-10-22T09:30:00.000Z',
    step,
    output: step === null ? '' : 'npm error code ELIFECYCLE\nnpm error errno 2\nnpm error even-keel@0.2.0 build: `tsc -p tsconfig.json`\nsrc/example.ts(1,7): error TS2322',
    rollback,
    rollbackStep: rollback === 'failed' ? 'install' : null,
  }
}

/**
 * The update parameters of `dev:fake`; without them — no newer release.
 * `?update=<version>` a newer release with its notes and toast, `&reverted` with a `### Reverted` section;
 * `?updateBlocked=<service|git|dirty|tag|checking>` no "Update", and why;
 * `?previous=<version>` this version came by an update from that one, `&storage` across a storage change;
 * `?updateResult=<done|step|rollback>` how the last update ended (`rollback` — bringing the old one back failed too);
 * `?updateProgress=<settling|running>` an update under way.
 */
export function fakeUpdates(params: URLSearchParams | null): UpdatesView {
  const version = params?.get('update') ?? ''
  const notes = version === '' ? [] : [note(version, params?.has('reverted') === true)]
  const blocked = params?.get('updateBlocked') as UpdateBlock | null | undefined
  const previous = params?.get('previous') ?? ''
  const progress = params?.get('updateProgress')
  return {
    current: INSTALLED,
    available: notes[0] === undefined ? null : { version, tag: notes[0].tag, url: notes[0].url },
    toast: notes.length > 0 && progress == null,
    notes,
    blocked: blocked != null && BLOCKS.includes(blocked) ? blocked : null,
    previous: previous === '' ? null : { version: previous, blocked: params?.has('storage') === true ? 'storage' : null },
    progress:
      progress == null
        ? null
        : { mode: 'update', target: version || '0.2.0', phase: progress === 'running' ? 'running' : 'settling', waiting: progress === 'running' ? [] : ['ABC'] },
    result: result(params?.get('updateResult') ?? null, previous || '0.0.9'),
  }
}

/** The toast's and the window's buttons; `null` for another command. */
export function fakeUpdatesCommand(state: EvenKeelState, name: string): EvenKeelState | null {
  const updates = state.updates
  if (name === 'updates/dismiss') return { ...state, updates: { ...updates, toast: false } }
  if (name === 'updates/seen') return { ...state, updates: { ...updates, result: null } }
  if (name === 'updates/install' && updates.available !== null)
    return { ...state, updates: { ...updates, toast: false, result: null, progress: { mode: 'update', target: updates.available.version, phase: 'settling', waiting: ['ABC'] } } }
  if (name === 'updates/revert' && updates.previous !== null)
    return { ...state, updates: { ...updates, result: null, progress: { mode: 'revert', target: updates.previous.version, phase: 'running', waiting: [] } } }
  if (name !== 'updates/mute') return null
  const shared = { ...state.config.shared, updates: { ...state.config.shared.updates, notify: false } }
  return { ...state, updates: { ...updates, toast: false }, config: { ...state.config, shared } }
}
