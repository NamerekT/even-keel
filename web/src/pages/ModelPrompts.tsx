import type { AccountView } from '../../../src/account/model.js'
import { runLabelText } from '../../../src/tracker/model.js'
import { t } from '../i18n/index.js'
import { RowsTable } from './settingsTable.js'
import { providerName } from './settingsRun.js'
import { useModelCatalog } from './useModels.js'
import { previewModels, type ProviderModels } from './modelPromptPreview.js'
import './model-prompts.css'

/** Prompt rows stay in table order; catalogue matches are advice and never restrict an entered pattern. */
export function ModelPrompts({ value, accounts, onChange }: { value: string; accounts: AccountView; onChange: (value: string) => void }) {
  const answers = useModelCatalog(accounts.accounts.map((account) => account.key))
  const catalog: ProviderModels[] = [...new Set(accounts.accounts.map((account) => account.agent))].map((provider) => {
    const lists = accounts.accounts.filter((account) => account.agent === provider).map((account) => answers[account.key])
    return {
      provider,
      models: [...new Set(lists.flatMap((list) => list?.models ?? []))],
      complete: lists.every((list) => list?.complete === true),
    }
  })
  const suggestions = catalog.flatMap(({ provider, models }) => [runLabelText({ provider, model: null }), ...models.map((model) => runLabelText({ provider, model }))])
  const note = (pattern: string) => {
    const matches = previewModels(pattern, catalog)
    const known = matches.some((entry) => entry.models.length > 0)
    return (
      <div className="model-prompts__matches" aria-live="polite">
        {!known && <p className="model-prompts__warning">{t.shared.promptNoMatches}</p>}
        {matches.filter((entry) => entry.models.length > 0 || !entry.complete).map(({ provider, models, complete }) => (
          <p key={provider}>
            <strong>{providerName(provider)}</strong> — {models.join(', ')}
            {!complete && <>{models.length > 0 ? '; ' : ''}{t.shared.promptAnyId}</>}
          </p>
        ))}
      </div>
    )
  }
  return (
    <div className="model-prompts">
      <RowsTable
        label={t.shared.modelPrompts}
        columns={[
          { title: t.shared.promptModel, placeholder: '* | *sonnet*', suggest: suggestions, mono: true, width: 'var(--model-prompt-width, 40%)' },
          { title: t.shared.promptText, placeholder: t.shared.promptAdd, multiline: true },
        ]}
        rows={JSON.parse(value) as string[][]}
        empty={t.shared.none}
        rowNote={(row) => note(row[0]!)}
        onChange={(rows) => onChange(JSON.stringify(rows))}
      />
    </div>
  )
}
