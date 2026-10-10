import { useState } from 'react'
import { Route, Routes } from 'react-router'
import { pickLanguage, setLanguage, t } from './i18n/index.js'
import { ActivityBar } from './layout/ActivityBar.js'
import { BasementSlot } from './layout/Basement.js'
import { ConfigBanner } from './layout/ConfigBanner.js'
import { UnattendedBanner } from './layout/UnattendedBanner.js'
import { Header } from './layout/Header.js'
import { LinkBanner } from './layout/LinkBanner.js'
import { McpBanner } from './layout/McpBanner.js'
import { UsageBanner } from './layout/UsageBanner.js'
import { useLive } from './live/context.js'
import { Home } from './pages/Home.js'
import { NotFound } from './pages/NotFound.js'
import { Project } from './pages/Project.js'
import { StatsPage } from './stats/StatsPage.js'
import { ToolsPage } from './tools/ToolsPage.js'

export function App() {
  const { state, link } = useLive()
  const [basement, setBasement] = useState<HTMLDivElement | null>(null)
  const language = pickLanguage(state?.language ?? null, navigator.languages)
  setLanguage(language)

  return (
    <div className="app" key={language}>
      <ActivityBar />
      <Header />
      <LinkBanner />
      <UsageBanner />
      <ConfigBanner />
      <UnattendedBanner />
      <McpBanner />
      <main className="content">
        {state === null ? (
          <p className="placeholder">{link === 'stale' ? t.app.noServer : t.app.connecting}</p>
        ) : (
          <BasementSlot.Provider value={basement}>
            <Routes>
              <Route path="/" element={<Home state={state} />} />
              <Route path="/p/:key" element={<Project state={state} />} />
              <Route path="/stats" element={<StatsPage state={state} />} />
              <Route path="/tools" element={<ToolsPage state={state} />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BasementSlot.Provider>
        )}
      </main>
      <div ref={setBasement} />
    </div>
  )
}
