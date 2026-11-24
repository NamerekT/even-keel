import { describe, expect, it } from 'vitest'
import { pickedOf, placeOf, placesOf, type ChatPlaceDeps } from './places.js'

const OWN = 'machine-own'
const FAR = 'machine-far'
const AWAY = 'machine-away'
const BARE = 'machine-bare'

function deps(pool: string[], folders: Record<string, string> = { [FAR]: '/home/john/example-project', [AWAY]: 'D:\\example-project' }): ChatPlaceDeps {
  return {
    repo: (project) => (project === 'abc' ? 'C:\\repos\\example-project' : undefined),
    own: () => OWN,
    pool: () => pool,
    live: () => [OWN, FAR, AWAY, BARE],
    connected: (machine) => machine !== AWAY,
    folderOf: async (machine) => folders[machine],
  }
}

describe('chat places (BTN-1614)', () => {
  it("lists the pool's machines, the own one first, each with its folder and why it cannot take a chat", async () => {
    expect(await placesOf(deps([FAR, AWAY, OWN, BARE]), 'abc')).toEqual([
      { machine: OWN, folder: 'C:\\repos\\example-project', block: null },
      { machine: FAR, folder: '/home/john/example-project', block: null },
      { machine: AWAY, folder: 'D:\\example-project', block: 'offline' },
      { machine: BARE, folder: null, block: 'noFolder' },
    ])
  })

  it('without a pool lists the own machine and the machines that have a folder of the project', async () => {
    expect((await placesOf(deps([]), 'abc')).map((option) => option.machine)).toEqual([OWN, FAR, AWAY])
    expect(await placesOf(deps([], {}), 'abc')).toEqual([{ machine: OWN, folder: 'C:\\repos\\example-project', block: null }])
  })

  it('picks the own machine when it may, else the first machine that can take the chat', async () => {
    expect(pickedOf(await placesOf(deps([FAR, OWN]), 'abc'))).toBe(OWN)
    expect(pickedOf(await placesOf(deps([AWAY, FAR]), 'abc'))).toBe(FAR)
    expect(pickedOf(await placesOf(deps([AWAY]), 'abc'))).toBeNull()
  })

  it('places a chat on the machine named, in its folder, and refuses one out of the pool, without the folder or off the link', async () => {
    expect(await placeOf(deps([OWN, FAR]), 'abc', FAR)).toEqual({ machine: FAR, folder: '/home/john/example-project' })
    expect(await placeOf(deps([OWN, FAR]), 'abc')).toEqual({ machine: OWN, folder: 'C:\\repos\\example-project' })
    await expect(placeOf(deps([OWN, FAR]), 'abc', AWAY)).rejects.toMatchObject({ notice: { code: 'chats.notInPool' } })
    await expect(placeOf(deps([OWN, BARE]), 'abc', BARE)).rejects.toMatchObject({ notice: { code: 'chats.noFolder' } })
    await expect(placeOf(deps([OWN, AWAY]), 'abc', AWAY)).rejects.toMatchObject({ notice: { code: 'chats.noMachine' } })
    await expect(placeOf(deps([AWAY]), 'abc')).rejects.toMatchObject({ notice: { code: 'chats.noMachine' } })
    await expect(placeOf(deps([]), 'xyz')).rejects.toMatchObject({ notice: { code: 'chain.unknownProject' } })
  })
})
