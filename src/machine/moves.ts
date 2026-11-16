import type { ActiveChain, CurrentTask, DispatcherDeps, ReturnReason } from '../chain/model.js'
import type { HandoffReason, HandoffSession } from '../chain/relay.js'
import { handoverMemory, Handovers, type HandoverMemory } from './handover.js'
import type { MoveDeps } from './host.js'
import { fieldsOf, MOVE_STATE_EVENT, type MoveCall, type MoveDone, type MoveName, type MoveSaved } from './move-call.js'
import { OverageStops } from './overage.js'
import type { MachinePort } from './port.js'

export * from './move-call.js'

export interface MachineMovesDeps {
  local: MachinePort
  emit: (type: string, payload: unknown) => Promise<unknown>
  journal: DispatcherDeps['journal']
  now: () => Date
  log: (line: string) => void
}

/**
 * The machine's side of the moves: each command runs `Handovers` or `OverageStops` with the machine's own port over the
 * task the hub sent. The memory of the moves (the retry ladder, the sources of a handoff) is the machine's, shared by all.
 */
export class MachineMoves {
  private readonly memory: HandoverMemory = handoverMemory()

  constructor(private readonly deps: MachineMovesDeps) {}

  async run(name: MoveName, call: MoveCall): Promise<MoveDone> {
    const { project, current, context } = call
    const chain: ActiveChain = { project, current: call.isCurrent && current !== undefined ? current : null, paused: false, error: null }
    let halt: MoveDone['halt']
    let saving: Promise<unknown> = Promise.resolve()
    const save = (): void => {
      if (current === undefined) return
      const saved: MoveSaved = { project, task: current.task, fields: fieldsOf(current) }
      saving = saving.then(() => this.deps.emit(MOVE_STATE_EVENT, saved)).catch((error: unknown) => {
        this.deps.log(`machine: the state of ${current.task} mid-move was not kept: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    const deps: MoveDeps = {
      machine: this.deps.local,
      journal: this.deps.journal,
      now: this.deps.now,
      log: this.deps.log,
      save,
      blocked: () => context.blocked ?? undefined,
      report: () => context.report ?? undefined,
      promptLanguage: () => context.language,
      mainBranch: () => context.mainBranch,
      pullRequests: () => context.pullRequests,
      plain: () => context.plain,
    }
    const state = { active: call.active ? [chain] : [] }
    const handovers = new Handovers(state, deps, (_, notice) => (halt = { notice, keep: notice.code === 'chain.modelUnavailable' }), this.memory)
    const task = (): CurrentTask => {
      if (current === undefined) throw new Error(`the move ${name} needs its task`)
      return current
    }
    // JSON carries a left-out argument as `null`; only `ask` means something by it.
    const args: unknown = call.args.map((arg) => arg ?? undefined)
    let value: unknown
    switch (name) {
      case 'follow':
        await handovers.follow(chain, task())
        break
      case 'guard':
        value = await new OverageStops(deps, (_, notice) => (halt = { notice, keep: false })).guard(chain)
        break
      case 'deliver': {
        const [session, prompt, ask, move] = args as [HandoffSession, string, string | undefined, 'answer' | 'review' | undefined]
        value = await handovers.deliver(chain, task(), session, prompt, ask ?? null, move)
        break
      }
      case 'deliverLoose': {
        const [loose, session, prompt] = args as [string, HandoffSession, string]
        value = await handovers.deliverLoose(project, loose, session, prompt)
        break
      }
      case 'replace': {
        const [replaced, session] = args as [string, HandoffSession]
        await handovers.replace(chain, task(), replaced, session)
        break
      }
      case 'renew': {
        const [session, prompt] = args as [HandoffSession, string]
        await handovers.renew(chain, task(), session, prompt)
        break
      }
      case 'handOverCurrent': {
        const [session, reason, extra] = args as [HandoffSession, 'restart' | 'message' | 'checkpoint' | 'review' | ReturnReason, string | undefined]
        await handovers.handOverCurrent(chain, task(), session, reason, extra)
        break
      }
      case 'handOver': {
        const [own, session, reason, extra] = args as [string, HandoffSession, HandoffReason, string | undefined]
        value = await handovers.handOver(own, session, reason, extra)
        break
      }
    }
    await saving
    return {
      ...(value === undefined ? {} : { value }),
      ...(current === undefined ? {} : { current: fieldsOf(current) }),
      ...(halt === undefined ? {} : { halt }),
    }
  }
}
