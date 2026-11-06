import type { DiffLine } from '../../../src/changelog/diff.js'
import './diffLines.css'

/** Lines of a text against another (`diffSection`): added ones green, removed ones red, changed words marked inside a line. */
export function DiffLines({ lines }: { lines: DiffLine[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <div key={index} className={`diff-line diff-line--${line.kind}`}>
          {line.pieces.map((piece, at) =>
            piece.kind === 'added' ? (
              <ins key={at}>{piece.text}</ins>
            ) : piece.kind === 'removed' ? (
              <del key={at}>{piece.text}</del>
            ) : (
              <span key={at}>{piece.text}</span>
            ),
          )}
          {line.pieces.every((piece) => piece.text === '') && ' '}
        </div>
      ))}
    </>
  )
}
