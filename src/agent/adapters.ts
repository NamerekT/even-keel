import { claude } from '../claude/adapter.js'
import { CLAUDE } from '../claude/name.js'
import { codex } from '../codex/adapter.js'
import { CODEX } from '../codex/name.js'
import { copilot } from '../copilot/adapter.js'
import { COPILOT } from '../copilot/name.js'
import { demoAgent } from '../demo/agent.js'
import { DEMO_AGENT } from '../demo/model.js'
import { opencode } from '../opencode/adapter.js'
import { OPENCODE } from '../opencode/name.js'
import type { AgentAdapter } from './contract.js'

/**
 * The agents by the name accounts and sessions carry (`AccountHome.agent`, `SessionView.agent`). The demo's runs only
 * the demo project (BTN-776): it is no provider a config or a task's run names (`PROVIDERS`).
 */
export const AGENTS: Readonly<Record<string, AgentAdapter>> = {
  [CLAUDE]: claude,
  [CODEX]: codex,
  [OPENCODE]: opencode,
  [COPILOT]: copilot,
  [DEMO_AGENT]: demoAgent.adapter(),
}
