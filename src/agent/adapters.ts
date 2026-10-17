import { claude } from '../claude/adapter.js'
import { CLAUDE } from '../claude/name.js'
import type { AgentAdapter } from './contract.js'

/** The agents by the name accounts and sessions carry (`AccountHome.agent`, `SessionView.agent`). */
export const AGENTS: Readonly<Record<string, AgentAdapter>> = { [CLAUDE]: claude }
