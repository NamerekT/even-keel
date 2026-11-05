import { Fragment } from 'react'
import type { Notice } from '../../../src/notice/notice.js'
import { trustTexts } from '../i18n/trust.js'
import { CommandBlock } from '../ui/blocks.js'
import { trustCommandsOf, untrustedOf, type TrustCommand } from './trustRecovery.js'
import './projectAdd.css'

/** The pause's command under its notice; its label is only the shell, and the user too when two are shown. */
export function UntrustedCommands({ notice }: { notice: Notice | null }) {
  const place = untrustedOf(notice)
  if (place === null) return null
  const text = trustTexts()
  const commands = trustCommandsOf(place)
  const label = (each: TrustCommand) => [text.shell[each.shell], commands.length > 1 && each.as !== undefined ? text.asUser(each.as) : null]
    .filter((part) => part !== null).join(' · ')
  return (
    <div className="project-add__trust">
      {commands.map((each) => (
        <Fragment key={each.command}>
          {label(each) !== '' && <p>{label(each)}</p>}
          <CommandBlock command={each.command} />
        </Fragment>
      ))}
    </div>
  )
}
