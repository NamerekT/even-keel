import type { ActiveChain, CarrySession, ChainState, CurrentTask, SessionFix } from '../chain/model.js'
import type { Notice } from '../notice/notice.js'
import { Handovers } from './handover.js'
import type { MachineTaskDeps } from './host.js'
import { OverageStops } from './overage.js'
import { inTurn, startTask } from './start.js'

/** Machine-owned task execution. The hub calls it in its existing serialized turn. */
export class MachineTasks {
  readonly handovers: Handovers
  readonly overage: OverageStops

  constructor(
    private readonly state: ChainState,
    private readonly deps: MachineTaskDeps,
    halt: (chain: ActiveChain, error: Notice, keep?: boolean) => void,
  ) {
    this.handovers = new Handovers(state, deps, (chain, error) => halt(chain, error, error.code === 'chain.modelUnavailable'))
    this.overage = new OverageStops(state, deps, (chain, error) => halt(chain, error))
  }

  inTurn(current: CurrentTask): boolean { return inTurn(this.deps, current) }

  start(chain: ActiveChain, current: CurrentTask, fix: SessionFix | undefined, carry: CarrySession | undefined,
    feedback: string | undefined, delivered: () => void, halt: (failure: Notice) => void): Promise<void> {
    return startTask(this.state, this.deps, chain, current, fix, carry, feedback, delivered, halt)
  }
}
