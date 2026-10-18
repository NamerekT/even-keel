import { useState } from 'react'
import { Link, Navigate } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { localized, t } from '../i18n/index.js'
import { openQuestions, questionPath } from '../state.js'
import { emptyTurns, type HarborMeme, harborMemes } from '../ui/memes.js'
import { Typed, Typists } from '../ui/Typed.js'
import { LaunchChart, localDate } from './LaunchChart.js'
import { emptyKind, ProjectCard } from './ProjectCard.js'

const PEAK_DAY = localized((language) => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long' }))
const HOME_PACE = { charMs: 45, pauseMs: 3000 }
const ADD_PROJECT = '/projects/add'

export function Home({ state }: { state: EvenKeelState }) {
  // One draw per visit; the line follows the numbers as they change.
  const [draw] = useState(Math.random)
  const memes = harborMemes({
    projects: state.projects,
    launches: state.launches,
    questions: openQuestions(state.tasks),
    fiveHour: state.limits?.fiveHour?.usedPercentage ?? null,
  })
  const meme = memes[Math.floor(draw * memes.length)]!
  const turns = emptyTurns(state.projects.map((key) => emptyKind(state, key)))

  // A config that does not parse has its projects unknown, not none: the banner speaks, the wizard waits.
  if (state.projects.length === 0 && state.configError === null) return <Navigate to={ADD_PROJECT} replace />

  return (
    <section className="page">
      <header className="home__head">
        <h1 className="page__title">{t.home.title}</h1>
        <Link to={ADD_PROJECT} className="button button--small">
          + {t.home.add}
        </Link>
      </header>
      {/* The lines type the way the chains run: as many at once as `parallel` allows, in page order. */}
      <Typists count={state.chain.parallel}>
        <Typed
          key={meme.kind}
          parts={harborText(meme)}
          pace={HOME_PACE}
          className="page__meme"
          to={meme.kind === 'questions' ? questionPath(state, state.projects) : null}
        />
        {state.projects.length === 0 ? (
          <p className="placeholder">{t.home.empty}</p>
        ) : (
          <div className="cards">
            {state.projects.map((key, index) => (
              <ProjectCard key={key} state={state} project={key} turn={turns[index]!} />
            ))}
          </div>
        )}
      </Typists>
      <LaunchChart days={state.launches} projects={state.projects} />
    </section>
  )
}

function harborText(meme: HarborMeme): string[] {
  const { memes } = t.home
  switch (meme.kind) {
    case 'self':
      return memes.self
    case 'peak':
      return memes.peak(PEAK_DAY().format(localDate(meme.day)), meme.count)
    case 'favorite':
      return memes.favorite(meme.project, meme.count, meme.total)
    case 'questions':
      return memes.questions(meme.count)
    case 'limit':
      return memes.limit(meme.percent)
  }
}
