import type { Notice } from '../../../src/notice/notice.js'
import { trustTexts } from '../i18n/trust.js'
import { CommandBlock } from '../ui/blocks.js'
import { trustCommandsOf, untrustedOf } from './trustRecovery.js'
import './projectAdd.css'

export function UntrustedCommands({ notice }: { notice: Notice | null }) {
  const place = untrustedOf(notice)
  if (place === null) return null
  const text = trustTexts()
  const commands = trustCommandsOf(place)
  return (
    <div className="project-add__trust">
      <p>{place.platform === 'win32' ? text.terminalWin : text.terminal}</p>
      <CommandBlock command={commands.own} />
      {commands.as !== null && <>
        <p>{text.serviceUser(place.user)}</p>
        <CommandBlock command={commands.as} />
      </>}
    </div>
  )
}
