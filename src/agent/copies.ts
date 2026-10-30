import type { Agent } from './contract.js'
import { AGENTS } from './adapters.js'
import { notice } from '../notice/notice.js'

/**
 * Service operations for copies; source changes use the ordinary live config writer, a failed download its `fallBack`,
 * which may keep the copy chosen (`ConfigStore.fallBackCli`).
 */
export function copies(
  runtimes: Map<string, Agent>,
  save: (name: string, source: 'checked' | 'system') => void,
  fallBack: (name: string) => void,
  changed: () => void,
  check: () => Promise<void>,
) {
  const controlOf = (name: string) => {
    const cli = runtimes.get(name)?.cli
    if (!cli) throw new Error('Unknown agent')
    return cli
  }
  return {
    view: () => Object.fromEntries([...runtimes].flatMap(([name, agent]) => agent.cli ? [[name, agent.cli.view()]] : [])),
    blocked(name: string) {
      const view = runtimes.get(name)?.cli?.view()
      return view?.source === 'checked' && view.status !== 'ready' ? notice('agent.copyMissing', { title: AGENTS[name]!.title, agent: name }) : undefined
    },
    download(name: string) {
      const cli = controlOf(name)
      save(name, 'checked')
      void cli.download().catch((error: unknown) => {
        console.warn(`agents: ${name} download failed: ${String(error)}`)
        fallBack(name)
      }).finally(changed)
      changed()
    },
    system(name: string) {
      if (!controlOf(name).view().system) throw new Error('Installed CLI is not found')
      save(name, 'system')
      changed()
    },
    checked(name: string) { controlOf(name); save(name, 'checked'); changed() },
    check,
  }
}
