import type { Notice } from '../../../src/notice/notice.js'
import { say } from '../i18n/index.js'
import { CommandBlock } from '../ui/blocks.js'
import { NoticeFixButton } from './FixButtons.js'
import { refusalParts } from './remoteRefusal.js'
import { HelpTip } from './settingsParts.js'

/** A refusal in one line; the tool's own words behind a question mark, its fix button, a command to run under it. */
export function RefusalWords({ refusal }: { refusal: Notice }) {
  const { shown, detail, command } = refusalParts(refusal)
  return (
    <>
      {say(shown)}
      {detail !== null && (
        <>
          {' '}
          <HelpTip text={detail} lines />
        </>
      )}{' '}
      <NoticeFixButton project={null} notice={refusal} />
      {command !== null && <CommandBlock command={command} />}
    </>
  )
}
