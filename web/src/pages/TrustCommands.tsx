import { useEffect, useState } from 'react'
import type { Notice } from '../../../src/notice/notice.js'
import type { ProjectTrust } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { CommandBlock } from '../ui/blocks.js'
import { untrustedOf } from './noticeFix.js'
import { trustCommand, trustCommandAs } from './projectWizard.js'
import './projectAdd.css'

/** The commands that open `claude` in the folder to accept its trust: as the user at hand, then from another user's terminal. */
export function TrustCommands({ folder, platform, user }: { folder: string; platform: string; user: string }) {
  return (
    <>
      <CommandBlock command={trustCommand(folder, platform)} />
      <p>{t.wizard.trustUser(user)}</p>
      <CommandBlock command={trustCommandAs(folder, platform, user)} />
    </>
  )
}

/** Under a chain paused on a folder Claude Code does not trust: the commands that give the trust. */
export function UntrustedCommands({ notice }: { notice: Notice | null }) {
  const untrusted = untrustedOf(notice)
  if (untrusted === null) return null
  return (
    <div className="project-add__trust">
      <TrustCommands folder={untrusted.folder} platform={untrusted.platform} user={untrusted.user} />
    </div>
  )
}

/**
 * The warning of a project's settings while Claude may run its tasks and does not trust its folder (BTN-429): asked
 * when shown and again on each return to the page, from the terminal where the trust was given.
 */
export function TrustWarning({ project, account }: { project: string; account: string }) {
  const { query } = useLive()
  const [trust, setTrust] = useState<ProjectTrust | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    let live = true
    query<ProjectTrust>('project/trust', { project, account }).then(
      (answer) => live && setTrust(answer),
      () => live && setTrust(null),
    )
    return () => {
      live = false
    }
    // `query` is a new function on each render: the effect stands for the project, the account and the round.
  }, [project, account, round])

  const untrusted = trust?.trusted === false
  useEffect(() => {
    if (!untrusted) return
    const back = () => {
      if (document.visibilityState === 'visible') setRound((count) => count + 1)
    }
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', back)
    return () => {
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', back)
    }
  }, [untrusted])

  if (trust === null || trust.trusted) return null
  return (
    <div className="notice notice--warn project-add__trust">
      <p>{t.settings.untrusted}</p>
      <TrustCommands folder={trust.folder} platform={trust.platform} user={trust.user} />
    </div>
  )
}
