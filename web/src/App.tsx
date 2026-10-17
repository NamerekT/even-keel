import { useState } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router'
import type { EvenKeelState } from '../../src/state.js'
import { pickLanguage, say, setLanguage, t } from './i18n/index.js'
import { ActivityBar } from './layout/ActivityBar.js'
import { BasementSlot } from './layout/Basement.js'
import { ConfigBanner } from './layout/ConfigBanner.js'
import { UnattendedBanner } from './layout/UnattendedBanner.js'
import { Header } from './layout/Header.js'
import { LinkBanner } from './layout/LinkBanner.js'
import { PackagesBanner } from './layout/PackagesBanner.js'
import { FallbackToasts } from './layout/Fallbacks.js'
import { UpdateToast } from './layout/Updates.js'
import { UsageBanner } from './layout/UsageBanner.js'
import { ToastStack } from './ui/Toast.js'
import { useLive } from './live/context.js'
import { projectOfPath, projectPath } from './state.js'
import { AccountAddPage } from './pages/AccountAdd.js'
import { AccountsPage } from './pages/Accounts.js'
import { Home } from './pages/Home.js'
import { NotFound } from './pages/NotFound.js'
import { Project } from './pages/Project.js'
import { SharedSettings } from './pages/SharedSettings.js'
import { StatsPage } from './stats/StatsPage.js'
import { ToolsPage } from './tools/ToolsPage.js'

export function App() {
  const { state, link, blocked } = useLive()
  const [basement, setBasement] = useState<HTMLDivElement | null>(null)
  const language = pickLanguage(state?.language ?? null, navigator.languages)
  setLanguage(language)

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
      <Header />
      <LinkBanner />
      <UsageBanner />
      <ConfigBanner />
      <UnattendedBanner />
      <PackagesBanner />
      <main className="content">
        {state === null ? (
          <p className="placeholder">{link === 'stale' ? t.app.noServer : t.app.connecting}</p>
        ) : (
          <BasementSlot.Provider value={basement}>
            <Routes>
              <Route path="/" element={<Home state={state} />} />
              <Route path="/p/:id" element={<ProjectRoute state={state} />} />
              <Route path="/stats" element={<StatsPage state={state} />} />
              <Route path="/tools" element={<ToolsPage state={state} />} />
              <Route path="/settings" element={<SharedSettings state={state} />} />
              <Route path="/accounts" element={<AccountsPage state={state} />} />
              <Route path="/accounts/add" element={<AccountAddPage state={state} />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BasementSlot.Provider>
        )}
      </main>
      <div className="app__basement" ref={setBasement} />
      <ToastStack>
        <UpdateToast />
        <FallbackToasts />
      </ToastStack>
    </div>
  )
}

/** A link from before ids names the project by its key: it goes on to the id, keeping the task in the hash. */
function ProjectRoute({ state }: { state: EvenKeelState }) {
  const location = useLocation()
  const { project, byKey } = projectOfPath(state, useParams().id ?? '')
  if (byKey) return <Navigate replace to={{ pathname: projectPath(state, project), search: location.search, hash: location.hash }} />
  return <Project state={state} project={project} />
}
