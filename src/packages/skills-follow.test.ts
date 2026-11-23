import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { current } from './model.js'
import { Packages, type PackagesDeps } from './service.js'
import { cleanFixture, fixture, fixtureDir } from './service.fixture.js'
import { installedSkills } from './skills-package.js'
import { SKILLS_PACKAGE } from './skills.js'
import { loadPackages } from './store.js'

afterEach(() => cleanFixture())

describe("a machine elsewhere installs the hub's skills package (BTN-1565)", () => {
  const machineFile = () => join(fixtureDir(), 'machine', 'packages.json')
  const machineCache = () => join(fixtureDir(), 'machine', 'packages')

  /** A hub whose catalog has only `my-skills` with the skill `review`, installed. */
  async function hubWithSkills() {
    const { deps } = fixture()
    const roots = join(fixtureDir(), 'user-skills')
    mkdirSync(join(roots, 'review', 'refs'), { recursive: true })
    writeFileSync(join(roots, 'review', 'SKILL.md'), '# review')
    writeFileSync(join(roots, 'review', 'refs', 'list.md'), '- one')
    const hub = new Packages({ ...deps, skillRoots: () => [{ dir: roots, from: 'claude' }] })
    hub.setDefault('tools@example', false)
    await hub.wrapSkills(['review'])
    await hub.install(SKILLS_PACKAGE)
    return { hub, deps, theirs: current(loadPackages(deps.file)!.packages[SKILLS_PACKAGE]!)! }
  }

  const machineOf = (deps: PackagesDeps, skillsFromHub: PackagesDeps['skillsFromHub']) =>
    new Packages({ ...deps, hub: false, hubServers: () => [], file: machineFile(), cache: machineCache(), skillsDir: join(fixtureDir(), 'machine', 'skills'), skillsFromHub })

  const settled = async (machine: Packages) => {
    for (let waited = 0; machine.installingOf('project').length > 0; waited += 10) {
      if (waited > 10_000) throw new Error('still installing')
      await new Promise((done) => setTimeout(done, 10))
    }
  }

  it('takes the skills of the hub install from the hub, so the package is ready on a machine without its state/skills', async () => {
    const { hub, deps, theirs } = await hubWithSkills()
    const asked: string[] = []
    const machine = machineOf(deps, async (install) => {
      asked.push(install)
      return hub.skillsOf(install)
    })
    machine.follow(hub.catalogFor(['project'], []))
    await settled(machine)
    const mine = current(loadPackages(machineFile())!.packages[SKILLS_PACKAGE]!)!
    expect(mine).toMatchObject({ id: theirs.id, version: theirs.version })
    expect(existsSync(join(machineCache(), SKILLS_PACKAGE, theirs.id, 'plugin', 'skills', 'review', 'refs', 'list.md'))).toBe(true)
    expect(machine.unready('project')).toEqual([])
    expect(asked).toEqual([theirs.id])
    await Promise.all([machine.close(), hub.close()])
  })

  it('says the hub is away, not that Claude Code lacks the marketplace, when the hub does not answer', async () => {
    const { hub, deps } = await hubWithSkills()
    const machine = machineOf(deps, async () => undefined)
    machine.follow(hub.catalogFor(['project'], []))
    await settled(machine)
    expect(machine.view().packages.find((each) => each.name === SKILLS_PACKAGE)?.error?.code).toBe('packages.skillsAway')
    expect(machine.unready('project')).toEqual([SKILLS_PACKAGE])
    await Promise.all([machine.close(), hub.close()])
  })

  it('says the hub holds no files of an install it lost, and gives none for an id that is not one', async () => {
    const { hub, deps, theirs } = await hubWithSkills()
    expect(installedSkills(deps.cache, '..')).toBeNull()
    expect(installedSkills(deps.cache, `${theirs.id}/../${theirs.id}`)).toBeNull()
    const machine = machineOf(deps, async () => installedSkills(deps.cache, 'gone'))
    machine.follow(hub.catalogFor(['project'], []))
    await settled(machine)
    expect(machine.view().packages.find((each) => each.name === SKILLS_PACKAGE)?.error?.code).toBe('packages.skillsNotOnHub')
    await Promise.all([machine.close(), hub.close()])
  })
})
