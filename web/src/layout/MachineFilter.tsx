import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router'
import type { MachineCard } from '../../../src/state.js'
import { useLive } from '../live/context.js'
import { MACHINE_PARAM, severalMachines } from '../machineView.js'

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

type StripPaint = { color: string | null; paint: (color: string | null) => void }
const StripContext = createContext<StripPaint>({ color: null, paint: () => {} })

/** The colour of the strip under the header: a machine's page paints its own, a page with the panel the picked machine's. */
export function useMachineStripColor(): string | null {
  const { selected } = useMachineFilter()
  const { color } = useContext(StripContext)
  return color ?? selected?.color ?? null
}

/** A machine's page (BTN-1515): the strip takes `color` at each render it changes in, and drops it when the page goes. */
export function usePaintMachineStrip(color: string): void {
  const { paint } = useContext(StripContext)
  useEffect(() => paint(color), [color, paint])
  useEffect(() => () => paint(null), [paint])
}

/**
 * The machine chosen in the header (BTN-1051): global, in the address as `?machine=<id>`. A link that drops the
 * parameter on a page with the panel gets it back; "All machines" clears it.
 */
export function MachineFilterProvider({ children }: { children: ReactNode }) {
  const { state, read, onMachines } = useLive()
  const location = useLocation()
  const navigate = useNavigate()
  const several = severalMachines(state)
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
  const [painted, paint] = useState<string | null>(null)
  const strip = useMemo(() => ({ color: painted, paint }), [painted])
  return (
    <Context.Provider value={value}>
      <StripContext.Provider value={strip}>{children}</StripContext.Provider>
    </Context.Provider>
  )
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
