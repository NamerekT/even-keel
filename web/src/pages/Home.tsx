import { type ReactNode, useState } from 'react'
import { Link, Navigate } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { localized, t } from '../i18n/index.js'
import { openQuestions, projectSlots, questionPath } from '../state.js'
import { EmptyState, PageHead } from '../ui/blocks.js'
import { ClonesIcon, ColumnsIcon, GridIcon, NestedIcon } from '../ui/icons.js'
import { emptyTurns, type HarborMeme, harborMemes } from '../ui/memes.js'
import { Tipped } from '../ui/Tipped.js'
import { Typed, Typists } from '../ui/Typed.js'
import { type BlockLayout, GROUPINGS, type Grouping, homeBlocks, laidOut, zoneOf } from './homeGroups.js'
import { LaunchChart, localDate } from './LaunchChart.js'
import { emptyKind, ProjectCard } from './ProjectCard.js'
import { QuietRow } from './QuietRow.js'
import { firstRun } from '../../../src/setup.js'
import { SETUP, stepPath } from './setupSteps.js'
import { useGrouping } from './useGrouping.js'
import './home.css'

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
  const [grouping, setGrouping] = useGrouping()
  const blocks = homeBlocks(grouping, state.projects, state).map((block) => laidOut(block, (key) => zoneOf(state, key)))
  // Panels only when there is a group to set apart; a lone untitled block is the plain grid.
  const framed = blocks.some((block) => block.title !== null)
  // The punchlines go by the cards' order on the page, the quiet strips included.
  const order = blocks.flatMap((block) => [...block.sections.flatMap(({ cards }) => cards), ...block.quiet])
  const turns = emptyTurns(order.map((key) => emptyKind(state, key)))
  const turnOf = new Map(order.map((key, index) => [key, turns[index]!]))

  // A config that does not parse has its projects unknown, not none: the banner speaks, the wizard waits.
  // The first run walks the setup (BTN-310); the stats alone are asked about once there are projects: until then
  // nothing is collected (BTN-247).
  if (state.tally === null && state.configError === null)
    return <Navigate to={firstRun(state.tally, state.projects.length) ? SETUP : stepPath('stats')} replace />
  if (state.projects.length === 0 && state.configError === null) return <Navigate to={ADD_PROJECT} replace />

  return (
    <section className="page">
      <PageHead
        title={t.home.title}
        actions={
          <>
            {state.projects.length > 1 && <GroupingSwitch value={grouping} onChange={setGrouping} />}
            <Link to={ADD_PROJECT} className="button button--small">
              + {t.home.add}
            </Link>
          </>
        }
      />
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
          <EmptyState
            action={
              <Link to={ADD_PROJECT} className="button button--small">
                + {t.home.add}
              </Link>
            }
          >
            {t.home.empty}
          </EmptyState>
        ) : (
          <div className="home__groups">
            {blocks.map((block, index) => {
              const body = <BlockBody block={block} state={state} turnOf={turnOf} />
              if (!framed) return <div key={`all-${index}`} className="home__flat">{body}</div>
              const title = block.title ?? t.home.other
              return (
                <section key={block.title ?? `other-${index}`} className="home__group" aria-label={title}>
                  <h2 className="home__group-title">
                    {title}
                    <span className="home__group-count">{t.home.projects(block.count)}</span>
                  </h2>
                  {body}
                </section>
              )
            })}
          </div>
        )}
      </Typists>
      <LaunchChart days={state.launches} slots={projectSlots(state)} />
    </section>
  )
}

function BlockBody({ block, state, turnOf }: { block: BlockLayout; state: EvenKeelState; turnOf: Map<string, number> }) {
  return (
    <>
      {block.sections.map(({ title, cards }, at) => (
        <div key={title ?? `all-${at}`} className="home__section">
          {title !== null && <h3 className="home__section-title">{title}</h3>}
          <div className="cards">
            {cards.map((key) => (
              <ProjectCard key={key} state={state} project={key} turn={turnOf.get(key)!} />
            ))}
          </div>
        </div>
      ))}
      {block.quiet.length > 0 && (
        <div className="quiet-strip">
          {block.quiet.map((key) => (
            <QuietRow key={key} state={state} project={key} turn={turnOf.get(key)!} />
          ))}
        </div>
      )}
    </>
  )
}

const GROUPING_ICONS: Record<Grouping, () => ReactNode> = { none: GridIcon, remote: ClonesIcon, tracker: ColumnsIcon, both: NestedIcon }

function GroupingSwitch({ value, onChange }: { value: Grouping; onChange: (grouping: Grouping) => void }) {
  return (
    <div className="segmented home__grouping" role="group" aria-label={t.home.grouping}>
      {GROUPINGS.map((grouping) => {
        const Icon = GROUPING_ICONS[grouping]
        return (
          <Tipped key={grouping} tip={t.home.groupings[grouping]} inline>
            <button
              type="button"
              className={grouping === value ? 'segmented__item segmented__item--on' : 'segmented__item'}
              aria-label={t.home.groupings[grouping]}
              aria-pressed={grouping === value}
              onClick={() => onChange(grouping)}
            >
              <Icon />
            </button>
          </Tipped>
        )
      })}
    </div>
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
