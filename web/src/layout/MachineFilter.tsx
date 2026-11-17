import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router'
import type { MachineCard } from '../../../src/state.js'
import { useLive } from '../live/context.js'
import { MACHINE_PARAM } from '../machineView.js'

const REREAD_MS = 30_000
/** The pages with the machines panel; on the rest the choice is kept and comes back on return (BTN-1051). */
const PANEL_PAGES = ['/', '/p/:id', '/accounts', '/tools']

export interface MachineFilter {
  /** The hub's machines, the own one first; empty — not read yet, or one machine. */
  cards: MachineCard[]
  /** The page has the machines block: more than one machine, on a page with the panel. */
  shown: boolean
  /** The machine whose view the page shows; `null` — every machine. */
  selected: MachineCard | null
  open: boolean
  setOpen: (open: boolean) => void
  select: (machine: string | null) => void
}

const NONE: MachineFilter = { cards: [], shown: false, selected: null, open: false, setOpen: () => {}, select: () => {} }
const Context = createContext<MachineFilter>(NONE)

export const useMachineFilter = (): MachineFilter => useContext(Context)

/**
 * The machine chosen in the header (BTN-1051): global, in the address as `?machine=<id>`. A link that drops the
 * parameter on a page with the panel gets it back; "All machines" clears it.
 */
export function MachineFilterProvider({ children }: { children: ReactNode }) {
  const { state, read, onMachines } = useLive()
  const location = useLocation()
  const navigate = useNavigate()
  const several = Object.keys(state?.machineNames ?? {}).length > 1
  const cards = useCards(several, read, onMachines)
  const [open, setOpen] = useState(false)
  const param = new URLSearchParams(location.search).get(MACHINE_PARAM)
  const remembered = useRef<string | null>(param)
  if (param !== null) remembered.current = param
  const panelPage = PANEL_PAGES.some((pattern) => matchPath(pattern, location.pathname) !== null)

  useEffect(() => {
    if (param !== null || remembered.current === null || !panelPage) return
    const search = new URLSearchParams(location.search)
    search.set(MACHINE_PARAM, remembered.current)
    navigate({ pathname: location.pathname, search: search.toString(), hash: location.hash }, { replace: true })
  }, [param, panelPage, location.pathname, location.search, location.hash, navigate])

  const select = useCallback(
    (machine: string | null) => {
      remembered.current = machine
      const search = new URLSearchParams(location.search)
      if (machine === null) search.delete(MACHINE_PARAM)
      else search.set(MACHINE_PARAM, machine)
      navigate({ pathname: location.pathname, search: search.toString(), hash: location.hash })
    },
    [location.pathname, location.search, location.hash, navigate],
  )

  const shown = several && panelPage && cards.length > 1
  const selected = shown ? (cards.find((card) => card.id === param) ?? null) : null
  const value = useMemo(() => ({ cards, shown, selected, open: open && shown, setOpen, select }), [cards, shown, selected, open, select])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

/** The machines' cards, read again at each `machines` event and every `REREAD_MS` while the hub has several. */
function useCards(several: boolean, read: ReturnType<typeof useLive>['read'], onMachines: ReturnType<typeof useLive>['onMachines']): MachineCard[] {
  const [cards, setCards] = useState<MachineCard[]>([])
  useEffect(() => {
    if (!several) {
      setCards([])
      return
    }
    let live = true
    const load = () => void read<MachineCard[]>('machines/cards', {}).then((next) => live && setCards(next), () => {})
    load()
    const off = onMachines(load)
    const timer = setInterval(load, REREAD_MS)
    return () => {
      live = false
      off()
      clearInterval(timer)
    }
    // `useLive` gives new functions each render; the source behind them is one.
  }, [several])
  return cards
}
