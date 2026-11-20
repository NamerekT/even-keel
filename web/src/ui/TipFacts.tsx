import { Fragment, type ReactNode } from 'react'

/** A caption and its value; `null` — a fact the tip leaves out. */
export type TipFact = readonly [caption: string, value: ReactNode] | null

/**
 * A tip's facts, one a line (docs/design.md, "Facts are never glued"): the head, then the captions and values as two
 * columns, then the notes, a sentence a line. Spans only, so it fits an inline `Tipped` too.
 */
export function TipFacts({ head, rows = [], notes = [] }: { head?: ReactNode; rows?: readonly TipFact[]; notes?: readonly (string | null | undefined)[] }) {
  const facts = rows.filter((row): row is NonNullable<TipFact> => row !== null)
  return (
    <>
      {head !== undefined && <span className="tip__head">{head}</span>}
      {facts.length > 0 && (
        <span className="tip-facts">
          {facts.map(([caption, value]) => (
            <Fragment key={caption}>
              <span className="tip-facts__caption">{caption}</span>
              <span>{value}</span>
            </Fragment>
          ))}
        </span>
      )}
      {notes.filter((note): note is string => typeof note === 'string' && note !== '').map((note) => (
        <span key={note}>{note}</span>
      ))}
    </>
  )
}
