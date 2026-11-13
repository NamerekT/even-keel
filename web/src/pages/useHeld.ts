import { useEffect, useState } from 'react'

export interface Held {
  /** What the field shows: the sent value while the card still holds the one it was sent over. */
  shown: string
  /** The value just sent stands in the field until the card is read anew. */
  hold: (to: string) => void
  /** The edit was refused: back to what the card holds. */
  release: () => void
}

/**
 * A typed field between its save and the card's next read (BTN-1111): the card still holds the old value then, and
 * showing it for that moment reads as a lost edit. Any other value the card comes to hold wins over the held one.
 */
export function useHeld(current: string): Held {
  const [held, setHeld] = useState<{ from: string; to: string } | null>(null)
  useEffect(() => {
    if (held !== null && held.from !== current) setHeld(null)
  }, [current, held])
  return {
    shown: held !== null && held.from === current ? held.to : current,
    hold: (to) => setHeld({ from: current, to }),
    release: () => setHeld(null),
  }
}
