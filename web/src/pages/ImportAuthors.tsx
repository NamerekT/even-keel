import type { ImportAuthor, ImportAuthorKind } from '../../../src/tracker/import.js'
import type { ImportPlanAuthor } from '../../../src/tracker/import-plan.js'
import { language, t } from '../i18n/index.js'
import { Select } from '../ui/Select.js'
import { authorKinds } from './authorPicks.js'
import { TransferBlock } from './TransferPlan.js'

const count = (value: number) => value.toLocaleString(language)

/**
 * The plan's authors in the import window (BTN-1416): a row an author of the tracker, by how much each wrote, and what
 * it becomes — the agent, the user or a person under their name. `onPick` — `null` once the import began: the pick is fixed.
 */
export function ImportAuthors({ authors, onPick }: { authors: readonly ImportPlanAuthor[]; onPick: ((author: ImportAuthor, as: ImportAuthorKind) => void) | null }) {
  if (authors.length === 0) return null
  const words = t.transfer.imports.authors
  return (
    <TransferBlock title={words.title} help={words.tip}>
      <table className="transfer__table transfer__table--authors">
        <thead>
          <tr>
            <th scope="col">{words.author}</th>
            <th scope="col" className="transfer__num transfer__author-count">
              {t.transfer.counts.comments}
            </th>
            <th scope="col" className="transfer__num transfer__author-count">
              {t.transfer.imports.counts.changes}
            </th>
            <th scope="col">{t.transfer.imports.statusBecomes}</th>
          </tr>
        </thead>
        <tbody>
          {authors.map((author) => {
            const name = author.name ?? words.unnamed(author.kind)
            return (
              <tr key={`${author.kind} ${author.name ?? '\u0000'}`}>
                <td>
                  <span className={author.name === null ? 'transfer__muted' : undefined}>{name}</span>
                  {/* A narrow screen has no room for the count columns: the counts go under the name. */}
                  <span className="transfer__author-counts">
                    <span>
                      {t.transfer.counts.comments} {count(author.comments)}
                    </span>{' '}
                    <span>
                      {t.transfer.imports.counts.changes} {count(author.changes)}
                    </span>
                  </span>
                </td>
                <td className="transfer__num transfer__author-count">{count(author.comments)}</td>
                <td className="transfer__num transfer__author-count">{count(author.changes)}</td>
                <td className="transfer__becomes">
                  <Select
                    className="add-package__input"
                    label={words.pick(name)}
                    value={author.as}
                    disabled={onPick === null}
                    options={authorKinds(author).map((kind) => ({ value: kind, label: words.kinds[kind] }))}
                    onChange={(as) => onPick?.(author, as as ImportAuthorKind)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </TransferBlock>
  )
}
