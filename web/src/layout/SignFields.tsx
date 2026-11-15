import { useId } from 'react'
import type { AccountEntry } from '../../../src/account/model.js'
import { SIGNS, type Draft, type Sign } from '../accountAdd.js'
import { accountName } from '../accountName.js'
import { t } from '../i18n/index.js'
import { HelpTip } from '../pages/settingsParts.js'
import { CommandBlock } from '../ui/blocks.js'
import { FieldStrip } from '../ui/FieldStrip.js'
import { CheckIcon, KeyIcon } from '../ui/icons.js'
import { secretInput } from '../ui/secret.js'
import { Select } from '../ui/Select.js'
import { AgentIcon } from './accountParts.js'

/** Needs a terminal of its own: without one it prints nothing, so the page does not drive it (BTN-1005). */
const SETUP_TOKEN = 'claude setup-token'

interface Props {
  draft: Draft
  onDraft: (draft: Draft) => void
  /** The folders the token can be said to be of (`sameChoices`). */
  choices: AccountEntry[]
  accounts: AccountEntry[]
  failure: string | null
}

/**
 * How a Claude subscription signs in (BTN-1005): the CLI's full sign-in with what it gives, or a long token with only
 * what it lacks; for the token — the command that issues it, the field to paste it and the account it is of.
 */
export function SignFields({ draft, onDraft, choices, accounts, failure }: Props) {
  const group = useId()
  const words = t.addAccount.sign
  const sign: Sign = draft.sign ?? 'full'
  const same = choices.find((entry) => entry.key === draft.sameAs)
  const lines: Record<Sign, { plus: string[]; minus: string[] }> = {
    full: { plus: words.full.lines, minus: [words.full.honest] },
    token: { plus: [], minus: same === undefined ? words.token.lines : words.token.sameLines },
  }
  return (
    <>
      <fieldset className="add-package__field">
        <legend className="add-package__label add-package__legend">{words.legend}</legend>
        <div className="account-add__ways">
          {SIGNS.map((each) => (
            <label key={each} className="account-add__way">
              <input type="radio" name={group} value={each} checked={each === sign} onChange={() => onDraft({ ...draft, sign: each })} />
              <span className="account-add__way-icon">{each === 'full' ? <AgentIcon agent="claude" /> : <KeyIcon />}</span>
              <span className="account-add__way-title">
                {words[each].title}
                <HelpTip text={words[each].tip} align="start" />
              </span>
              <span className="account-add__way-check">
                <CheckIcon />
              </span>
              <span className="account-add__way-gets account-add__way-lines">
                {lines[each].plus.map((line) => (
                  <span key={line} className="account-add__way-line account-add__way-line--plus">
                    {line}
                  </span>
                ))}
                {lines[each].minus.map((line) => (
                  <span key={line} className="account-add__way-line account-add__way-line--minus">
                    {line}
                  </span>
                ))}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {sign === 'token' && (
        <>
          {same === undefined && <p className="notice notice--warn">{words.resets}</p>}
          <div className="add-package__field">
            <span className="add-package__label">{words.command}</span>
            <CommandBlock command={SETUP_TOKEN} />
            <p className="add-package__note">{words.commandNote}</p>
          </div>
          <label className="add-package__field">
            <span className="add-package__label">{words.token.field}</span>
            <FieldStrip line={failure === null ? null : { tone: 'error', text: failure }} fold wide>
              <input
                className="add-package__input add-package__input--mono"
                {...secretInput()}
                value={draft.token ?? ''}
                aria-invalid={failure !== null}
                onChange={(event) => onDraft({ ...draft, token: event.target.value })}
              />
            </FieldStrip>
          </label>
          {choices.length > 0 && (
            <div className="add-package__field">
              <span className="add-package__label">{words.sameAs}</span>
              <Select
                className="add-package__input"
                label={words.sameAs}
                value={same?.key ?? ''}
                options={[{ value: '', label: words.sameNone }, ...choices.map((entry) => ({ value: entry.key, label: accountName(entry, accounts) }))]}
                onChange={(key) => onDraft({ ...draft, sameAs: key === '' ? undefined : key })}
              />
              <p className="add-package__note">{words.sameNote}</p>
            </div>
          )}
        </>
      )}
    </>
  )
}
