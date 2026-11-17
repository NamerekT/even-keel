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
    hub: false,
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
  })
}
