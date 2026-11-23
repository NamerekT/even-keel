import type { HubEnd, Opened } from './hub.js'
import type { HubTransport, StreamSink } from './machine.js'
import { isRefusal, type CredentialsAnswer, type CredentialsPost, type EventsAnswer, type EventsPost, type HookAnswer, type HookPost, type MachineHello, type McpAnswer, type McpPost, type Refusal, type SkillsAnswer, type SkillsPost, type SnapshotPost, type TallyAnswer, type TallyPost } from './protocol.js'

/**
 * The pulse of a link inside one process: there is no network to lose, and a timer of days never fires between two
 * restarts of the service. Both ends still count and confirm as over HTTPS.
 */
export const LOCAL_HEARTBEAT_MS = 10 * 24 * 60 * 60 * 1000

/** What a carrier would have made of it: only JSON gets through, so both sides see what a machine elsewhere would. */
const carried = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/**
 * The carrier between a hub and the machine of the same process (`docs/machines.md`, "One process"): the ends call
 * each other directly, without HTTPS and a certificate, with the same numbers, confirmations and snapshot.
 */
export class LocalTransport implements HubTransport {
  constructor(private readonly hub: HubEnd, private readonly authorization: string) {}

  open(hello: MachineHello, sink: StreamSink): { close(): void } {
    let shut = false
    let opened: Opened | undefined
    sink.opened()
    void this.hub.open(this.authorization, carried(hello), {
      send: (frame) => {
        if (!shut) sink.frame(carried(frame))
      },
      close: () => {
        if (shut) return
        shut = true
        sink.closed()
      },
    }).then(
      (result) => {
        if (isRefusal(result)) {
          shut = true
          sink.closed(result)
        } else if (shut) result.closed()
        else opened = result
      },
      () => {
        if (shut) return
        shut = true
        sink.closed()
      },
    )
    return {
      close: () => {
        if (shut) return
        shut = true
        opened?.closed()
      },
    }
  }

  events(post: EventsPost): Promise<EventsAnswer | Refusal> {
    return this.hub.events(this.authorization, carried(post))
  }

  snapshot(post: SnapshotPost): Promise<EventsAnswer | Refusal> {
    return this.hub.snapshot(this.authorization, carried(post))
  }

  async mcp(post: McpPost): Promise<McpAnswer | Refusal> {
    return carried(await this.hub.mcp(this.authorization, carried(post)))
  }

  async hook(post: HookPost): Promise<HookAnswer | Refusal> {
    return carried(await this.hub.hook(this.authorization, carried(post)))
  }

  async credentials(post: CredentialsPost): Promise<CredentialsAnswer | Refusal> {
    return carried(await this.hub.credentials(this.authorization, carried(post)))
  }

  /** Never posted in practice: the hub's own machine does not follow the hub's catalog. */
  async skills(post: SkillsPost): Promise<SkillsAnswer | Refusal> {
    return carried(await this.hub.skills(this.authorization, carried(post)))
  }

  /** Never posted in practice: the hub's own machine is read by the hub's own collector. */
  async tally(post: TallyPost): Promise<TallyAnswer | Refusal> {
    return carried(await this.hub.tally(this.authorization, carried(post)))
  }
}
