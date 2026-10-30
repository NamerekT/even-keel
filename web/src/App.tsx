import { useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router'
import type { EvenKeelState } from '../../src/state.js'
import { pickLanguage, say, setAccountNames, setLanguage, setProjectLabels, t } from './i18n/index.js'
import { accountName } from './accountName.js'
import { ActivityBar } from './layout/ActivityBar.js'
import { BasementSlot } from './layout/Basement.js'
import { AppHeader } from './layout/AppHeader.js'
import { LoginDialog } from './layout/LoginDialog.js'
import { EventToasts } from './layout/EventToasts.js'
import { FallbackToasts } from './layout/Fallbacks.js'
import { UpdateProgressToast, UpdateResultToast, UpdateToast, UpdateWindow } from './layout/Updates.js'
import { ToastStack } from './ui/Toast.js'
import { useLive } from './live/context.js'
import { projectOfPath, projectPath } from './state.js'
import { addOf, legacyAdd } from './accountAdd.js'
import { AddAccountDialog } from './layout/AddAccountDialog.js'
import { CliConsent } from './layout/CliCopies.js'
import { AccountsPage } from './pages/Accounts.js'
import { knownSessions, pruneDrafts } from './pages/chatDraft.js'
import { Home } from './pages/Home.js'
import { NotFound } from './pages/NotFound.js'
import { Project } from './pages/Project.js'
import { ProjectAddPage } from './pages/ProjectAdd.js'
import { SetupPage } from './pages/Setup.js'
import { SETUP } from './pages/setupSteps.js'
import { SharedSettings } from './pages/SharedSettings.js'
import { StatusPage } from './pages/StatusPage.js'
import { StatsPage } from './stats/StatsPage.js'
import { ToolsPage } from './tools/ToolsPage.js'

export function App() {
  const { state, link, blocked } = useLive()
  const [basement, setBasement] = useState<HTMLDivElement | null>(null)
  const addingAccount = addOf(new URLSearchParams(useLocation().search)) !== null
  const language = pickLanguage(state?.language ?? null, navigator.languages)
  setLanguage(language)
  setProjectLabels(state?.projectLabels ?? {})
  const accounts = state?.account.accounts ?? []
  setAccountNames(Object.fromEntries(accounts.map((entry) => [entry.key, accountName(entry, accounts)])))
  const pruned = useRef(false)
  useEffect(() => {
    if (state === null || pruned.current) return
    pruned.current = true
    void pruneDrafts(knownSessions(state))
  }, [state])

  if (blocked !== undefined)
    return (
      <div className="app" key={language}>
        <div className="banner banner--error" role="alert">
          <div className="banner__inner">
            <span>{t.app.blocked(say(blocked))}</span>
          </div>
        </div>
      </div>
    )

  return (
    <div className="app" key={language}>
      <ActivityBar />
      <AppHeader />
      <main className="content">
        {state === null ? (
          <p className="placeholder">{link === 'stale' ? t.app.noServer : t.app.connecting}</p>
        ) : (
          <BasementSlot.Provider value={basement}>
            <Routes>
              <Route path="/" element={<Home state={state} />} />
              <Route path="/p/:id" element={<ProjectRoute state={state} />} />
              <Route path="/projects/add" element={<ProjectAddPage state={state} />} />
              <Route path="/stats" element={<StatsPage state={state} />} />
              <Route path={SETUP} element={<SetupPage state={state} />} />
              <Route path="/tools" element={<ToolsPage state={state} />} />
              <Route path="/settings" element={<SharedSettings state={state} />} />
              <Route path="/status" element={<StatusPage state={state} />} />
              <Route path="/accounts" element={<AccountsPage state={state} />} />
              <Route path="/accounts/add" element={<LegacyAdd />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BasementSlot.Provider>
        )}
      </main>
      <div className="app__basement" ref={setBasement} />
      {/* The add dialog walks its own sign-in in place. */}
      {state !== null && state.account.login !== null && !addingAccount && <LoginDialog account={state.account} />}
      {state !== null && <AddAccountDialog account={state.account} />}
      <CliConsent />
      <UpdateWindow />
      <ToastStack>
        <UpdateProgressToast />
        <UpdateResultToast />
        <UpdateToast />
        <FallbackToasts />
        <EventToasts />
      </ToastStack>
    </div>
  )
}

/** The add page of before BTN-352: the accounts list with the add dialog open at the same step. */
function LegacyAdd() {
  return <Navigate replace to={legacyAdd(new URLSearchParams(useLocation().search))} />
}

/** A link from before ids names the project by its key: it goes on to the id, keeping the task in the hash. */
function ProjectRoute({ state }: { state: EvenKeelState }) {
  const location = useLocation()
  const { project, byKey } = projectOfPath(state, useParams().id ?? '')
  if (byKey) return <Navigate replace to={{ pathname: projectPath(project), search: location.search, hash: location.hash }} />
  return <Project state={state} project={project} />
}
