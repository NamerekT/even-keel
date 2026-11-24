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

/**
 * The two cards of a Claude subscription's sign-in (BTN-1005), on the hub and on a machine elsewhere alike (BTN-1501):
 * the full sign-in with what it gives, the long token with only what it lacks — less when `tied` to an account whose
 * full sign-in hands it the limits.
 */
export function SignWays({ sign, tied, onSign, hint }: { sign: Sign; tied: boolean; onSign: (sign: Sign) => void; hint?: string }) {
  const group = useId()
  const words = t.addAccount.sign
  const lines: Record<Sign, { plus: string[]; minus: string[] }> = {
    full: { plus: words.full.lines, minus: [words.full.honest] },
    token: { plus: [], minus: tied ? words.token.sameLines : words.token.lines },
  }
  return (
    <fieldset className="add-package__field">
      <legend className="add-package__label add-package__legend">
        <span className="add-package__label-row">
          {words.legend}
          {hint !== undefined && hint !== '' && <HelpTip text={hint} align="start" />}
        </span>
      </legend>
      <div className="account-add__ways">
        {SIGNS.map((each) => (
          <label key={each} className="account-add__way">
            <input type="radio" name={group} value={each} checked={each === sign} onChange={() => onSign(each)} />
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
  )
}

interface Props {
  draft: Draft
  onDraft: (draft: Draft) => void
  /** The folders the token can be said to be of (`sameChoices`). */
  choices: AccountEntry[]
  accounts: AccountEntry[]
  failure: string | null
  /** What the sign-in needs next, in the "?" of its heading. */
  hint?: string
}

/**
 * How a Claude subscription signs in (BTN-1005): the CLI's full sign-in with what it gives, or a long token with only
 * what it lacks; for the token — the command that issues it, the field to paste it and the account it is of.
 */
export function SignFields({ draft, onDraft, choices, accounts, failure, hint }: Props) {
  const words = t.addAccount.sign
  const sign: Sign = draft.sign ?? 'full'
  const same = choices.find((entry) => entry.key === draft.sameAs)
  return (
    <>
      <SignWays sign={sign} tied={same !== undefined} onSign={(each) => onDraft({ ...draft, sign: each })} hint={hint} />
      {sign === 'token' && (
        <>
          {same === undefined && <p className="notice notice--warn">{words.resets}</p>}
          <div className="add-package__field">
            <span className="add-package__label-row">
              <span className="add-package__label">{words.command}</span>
              <HelpTip text={words.commandNote} align="start" />
            </span>
            <CommandBlock command={SETUP_TOKEN} />
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
              <span className="add-package__label-row">
                <span className="add-package__label">{words.sameAs}</span>
                <HelpTip text={words.sameNote} align="start" />
              </span>
              <Select
                className="add-package__input"
                label={words.sameAs}
                value={same?.key ?? ''}
                options={[{ value: '', label: words.sameNone }, ...choices.map((entry) => ({ value: entry.key, label: accountName(entry, accounts) }))]}
                onChange={(key) => onDraft({ ...draft, sameAs: key === '' ? undefined : key })}
              />
            </div>
          )}
        </>
      )}
    </>
  )
}
