import { useEffect, useState } from 'react'
import type { EvenKeelState } from '../../../src/state.js'
import { ghostOf, type ChainBlock, type Ghost } from '../state.js'
import { stillMotion } from '../ui/landing.js'
import type { Box } from '../ui/reorder.js'

const LANDED_MS = 1600
const NARROW = '(max-width: 760px)'

interface Moving {
  id: string
  title: string
  from: Box
  /** The command has been answered: without the task in the chain by now there is nothing to wait for. */
  settled: boolean
}

export interface Arrival {
  id: string
  /** The copy of the backlog row is still on its way to the block. */
  flying: boolean
}

/**
 * A backlog task's way into the chain: a ghost where it would stand while its button is pointed at or pressed,
 * then the flight of its row to the block it became and a mark on that block.
 * On a narrow screen the panel covers the chain, so it is closed instead of the flight.
 */
export function useArrival(state: EvenKeelState, project: string, blocks: ChainBlock[], closePanel: () => void) {
  const [pointed, setPointed] = useState<string | null>(null)
  const [moving, setMoving] = useState<Moving | null>(null)
  const [flight, setFlight] = useState<Moving | null>(null)
  const [landed, setLanded] = useState<string | null>(null)
  const arrived = moving !== null && blocks.some((block) => block.id === moving.id && block.open)

  useEffect(() => {
    if (moving === null) return
    if (!arrived) {
      if (moving.settled) setMoving(null)
      return
    }
    const narrow = window.matchMedia(NARROW).matches
    if (narrow) closePanel()
    if (narrow || stillMotion()) setLanded(moving.id)
    else setFlight(moving)
    setMoving(null)
  }, [moving, arrived, closePanel])

  useEffect(() => {
    if (landed === null) return
    const timer = setTimeout(() => setLanded(null), LANDED_MS)
    return () => clearTimeout(timer)
  }, [landed])

  const ghost: Ghost | null = arrived ? null : ghostOf(state, project, moving?.id ?? pointed)
  const arrival: Arrival | null = flight !== null ? { id: flight.id, flying: true } : landed !== null ? { id: landed, flying: false } : null

  return {
    ghost,
    arrival,
    flight,
    /** The task on its way from the backlog: its own flight marks it, the chain's entry motion must not. */
    incoming: moving?.id ?? flight?.id ?? landed,
    point: setPointed,
    move: (id: string, title: string, from: Box) => {
      setLanded(null)
      setMoving({ id, title, from, settled: false })
    },
    settle: (id: string) => setMoving((current) => (current?.id === id ? { ...current, settled: true } : current)),
    land: (id: string) => {
      setFlight((current) => (current?.id === id ? null : current))
      setLanded(id)
    },
  }
}
