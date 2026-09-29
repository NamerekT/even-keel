import { Route, Routes } from 'react-router'
import { ConfigBanner } from './layout/ConfigBanner.js'
import { Header } from './layout/Header.js'
import { LinkBanner } from './layout/LinkBanner.js'
import { UsageBanner } from './layout/UsageBanner.js'
import { useLive } from './live/context.js'
import { Home } from './pages/Home.js'
import { NotFound } from './pages/NotFound.js'
import { Project } from './pages/Project.js'

export function App() {
  const { state, link } = useLive()

  return (
    <div className="app">
      <Header />
      <LinkBanner />
      <UsageBanner />
      <ConfigBanner />
      <main className="content">
        {state === null ? (
          <p className="placeholder">{link === 'stale' ? 'Нет связи с сервером Baton.' : 'Подключение…'}</p>
        ) : (
          <Routes>
            <Route path="/" element={<Home state={state} />} />
            <Route path="/p/:key" element={<Project state={state} />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        )}
      </main>
    </div>
  )
}
