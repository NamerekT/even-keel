import { homedir } from 'node:os'
import { join } from 'node:path'
import { sessionBase } from '../agent/env.js'
import { CLAUDE } from '../claude/name.js'
import { CODEX } from '../codex/name.js'
import { home as dataHome, root } from '../locations.js'
import { Packages } from '../packages/service.js'
import { trackerKeyRules } from '../tracker/adapters.js'
import type { MachineContext } from './machine-context.js'

export function wireMachinePackages(ctx: MachineContext): Packages {
  return new Packages({
    // The hub's own machine follows Even Keel's own marketplace; a machine on the network (`planFirst`) the hub's installs (BTN-1689).
    hub: ctx.planFirst !== true,
    hubServers: () => ctx.brief.hubServers(),
    file: join(ctx.stateDir, 'packages.json'),
    cache: join(ctx.stateDir, 'packages'),
    envFile: join(dataHome, '.env'),
    get repos() { return ctx.configStore.current.projects },
    globalDir: ctx.homes.global.dir,
    ownDir: root,
    skillsDir: join(ctx.stateDir, 'skills'),
    skillRoots: () => [
      { dir: join(ctx.homes.global.dir, 'skills'), from: CLAUDE },
      { dir: join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'skills'), from: CODEX },
      { dir: join(homedir(), '.agents', 'skills'), from: CODEX },
    ],
    // A machine on the network (`planFirst`) has none of the hub's `state/skills/`: its skills package is the hub's (BTN-1565).
    ...(ctx.planFirst === true && { skillsFromHub: (install: string) => ctx.tell.skills(install) }),
    claudeConfigs: ctx.claudeConfigs,
    rules: trackerKeyRules(),
    tracker: (project) => ctx.brief.tracker(project),
    serverOverride: (project, name, server) => ctx.brief.serverOf(project, name, server),
    agentOf: (project) => ctx.homes.find(ctx.choiceFor(project).account)?.agent ?? CLAUDE,
    updateMarketplace: (marketplace) => ctx.agentOf(ctx.homes.global).updateMarketplace!(ctx.homes.global, marketplace, ctx.PLUGIN_UPDATE_TIMEOUT_MS),
    addMarketplace: (dir) => ctx.agentOf(ctx.homes.global).addMarketplace!(ctx.homes.global, dir, ctx.PLUGIN_UPDATE_TIMEOUT_MS),
    baseEnv: () => sessionBase(process.env, ctx.packages.keyNames(), ctx.envFile.own()),
    poolOf: () => ({}),
    port: ctx.mcpPort,
    log: (line) => console.log(line),
    onChange: () => ctx.machineChanged(),
    waited: (project) => ctx.brief.active().some((chain) => chain.project === project && !chain.paused),
  })
}
