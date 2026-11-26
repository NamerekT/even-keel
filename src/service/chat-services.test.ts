import { describe, expect, it } from 'vitest'
import { chatServicesOf } from './chats.js'

const OWN = 'machine-own'
const FAR = 'machine-far'

/** A link whose machine elsewhere has a mirror, connected or not; the mirror's calls would wait for its return. */
function linkOf(connected: boolean) {
  const own = { chat: {}, chats: {} }
  const far = { chat: {}, chats: {} }
  const link = {
    own: () => OWN,
    services: own,
    mirror: (machine: string) => (machine === FAR ? { services: () => far } : undefined),
    network: { connected: (machine: string) => connected && machine === FAR },
  }
  return { services: chatServicesOf(link as unknown as Parameters<typeof chatServicesOf>[0]), own, far }
}

describe("the chats' commands to a machine (BTN-1739)", () => {
  it("are none for a machine elsewhere off the link, though the hub keeps its mirror", () => {
    const { services } = linkOf(false)
    expect(services(FAR)).toBeUndefined()
  })

  it("are the mirror's for a machine elsewhere connected now", () => {
    const { services, far } = linkOf(true)
    expect(services(FAR)).toBe(far)
  })

  it("are the own machine's own commands, and none for a machine never seen", () => {
    const { services, own } = linkOf(false)
    expect(services(OWN)).toBe(own)
    expect(linkOf(true).services('machine-unknown')).toBeUndefined()
  })
})
