import { useState } from 'react'
import type { EvenKeelState } from '../../../src/state.js'
import { localized, t } from '../i18n/index.js'
import { openQuestions } from '../state.js'
import { type HarborMeme, harborMemes } from '../ui/memes.js'
import { LaunchChart, localDate } from './LaunchChart.js'
import { ProjectCard } from './ProjectCard.js'

const PEAK_DAY = localized((language) => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long' }))

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

  return (
    <section className="page">
      <h1 className="page__title">{t.home.title}</h1>
      <p className="page__meme">{harborText(meme)}</p>
      {state.projects.length === 0 ? (
        <p className="placeholder">{t.home.empty}</p>
      ) : (
        <div className="cards">
          {state.projects.map((key) => (
            <ProjectCard key={key} state={state} project={key} />
          ))}
        </div>
      )}
      <LaunchChart days={state.launches} projects={state.projects} />
    </section>
  )
}

function harborText(meme: HarborMeme): string {
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
