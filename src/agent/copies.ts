import type { Agent } from './contract.js'
import { AGENTS } from './adapters.js'
import { notice } from '../notice/notice.js'

/** The providers whose copy was once downloaded with consent (`service_state` `cli.downloaded`, BTN-1175). */
export interface CopyConsent {
  downloaded: readonly string[]
  remember: (downloaded: string[]) => void
  /** On a machine, the providers the hub consented to (`HubBrief.cliConsent`, BTN-1516): its consent is the machine's too. */
  hub?: () => readonly string[]
}

/**
 * Service operations for copies; source changes use the ordinary live config writer, a failed download its `fallBack`,
 * which may keep the copy chosen (`ConfigStore.fallBackCli`). Consent to Checked is given once: a provider on Checked
 * whose copy was ever downloaded with it fetches each new checked version by itself (BTN-1175).
 */
export function copies(
  runtimes: Map<string, Agent>,
  save: (name: string, source: 'checked' | 'system') => void,
  fallBack: (name: string) => void,
  changed: () => void,
  check: () => Promise<void>,
  consent: CopyConsent,
) {
  const consented = new Set(consent.downloaded)
  const remember = (name: string) => {
    if (consented.has(name)) return
    consented.add(name)
    consent.remember([...consented].sort())
  }
  // A copy on disk from before the record, the old version the next sweep removes included.
  for (const [name, agent] of runtimes) if (agent.cli?.hadCopy?.()) remember(name)

  const controlOf = (name: string) => {
    const cli = runtimes.get(name)?.cli
    if (!cli) throw new Error('Unknown agent')
    return cli
  }
  const fetch = (name: string) => {
    const cli = controlOf(name)
    void cli.download().then(() => {
      if (cli.view().status === 'ready') remember(name)
    }, (error: unknown) => {
      console.warn(`agents: ${name} download failed: ${String(error)}`)
      fallBack(name)
    }).finally(changed)
    changed()
  }
  /** Missing, not failed: a failed download waits for the explicit retry. */
  const fetchesItself = (name: string) => {
    const view = runtimes.get(name)?.cli?.state()
    return (consented.has(name) || (consent.hub?.().includes(name) ?? false)) && view?.source === 'checked' && view.status === 'missing'
  }
  const auto = (name: string) => {
    const whose = consented.has(name) ? 'its copy was downloaded with consent before' : 'the hub consented to its copy'
    console.log(`agents: ${name} downloads the checked version ${runtimes.get(name)!.cli!.view().version} by itself, ${whose}`)
    fetch(name)
  }
  return {
    view: () => Object.fromEntries([...runtimes].flatMap(([name, agent]) => agent.cli ? [[name, agent.cli.view()]] : [])),
    /** `downloading` — the copy is on its way, so the wait ends by itself; the hub tells a machine's pause by it. */
    blocked(name: string) {
      const view = runtimes.get(name)?.cli?.state()
      if (view?.source !== 'checked' || view.status === 'ready') return undefined
      const fetches = fetchesItself(name)
      if (fetches) auto(name)
      return notice('agent.copyMissing', { title: AGENTS[name]!.title, agent: name, downloading: fetches || view.status === 'downloading' })
    },
    /** The providers consented to here, for the hub's brief to its machines. */
    consented: (): string[] => [...consented].sort(),
    /** At the start: the consented providers on Checked fetch a checked version they lack; gives their names. */
    resume(): string[] {
      const names = [...runtimes.keys()].filter(fetchesItself)
      for (const name of names) auto(name)
      return names
    },
    download(name: string) {
      controlOf(name)
      save(name, 'checked')
      fetch(name)
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
