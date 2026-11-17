import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState, PackagesView, PackageView } from '../../../src/state.js'
import { formatAgo } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { Section, Switch } from '../pages/settingsParts.js'
import { Band, EmptyState } from '../ui/blocks.js'
import { Tipped } from '../ui/Tipped.js'
import { AddPackage } from './AddPackage.js'
import { catalogIssues, looseKeys, PACKAGE_PARAM, packageGroups, packageKeys } from './packageGroups.js'
import { BuiltInTag, GroupBox, ImportOffers, IssueBands, KeyList, PackageBrings, PackageLine, PackageSettings, rowId, ScriptsSwitch } from './PackagesParts.js'
import { passes, pendingCommands, rowNeedsInstall } from './packageView.js'
import { useRowFocus } from './useRowFocus.js'

const SCOPE = 'catalog'

/**
 * The catalog of packages on the shared settings (BTN-802): everything that changes a package for every project at once —
 * install, update, the default, the shared values and the keys. A project turns a package on in its own packages.
 */
export function PackageCatalog({ state }: { state: EvenKeelState }) {
  const view = state.packages
  const [params] = useSearchParams()
  const asked = params.get(PACKAGE_PARAM)
  const [open, setOpen] = useState<string | null>(asked)
  const go = useRowFocus(SCOPE, setOpen)
  const groups = packageGroups(view.packages, view.marketplace?.name ?? null)
  const issues = catalogIssues(view)
  const loose = looseKeys(view)
  useEffect(() => {
    if (asked !== null) go(asked)
  }, [asked, go])

  return (
    <>
      <Section
        title={t.packages.catalog}
        hint={`${t.packages.hint} ${t.packages.catalogHint}`}
        className="packages"
        aside={
          <span className="packages__head-actions">
            <CheckAll view={view} />
            <UpdateAll view={view} />
            {groups.length > 0 && <AddPackage view={view} />}
          </span>
        }
      >
        {view.gateway !== null && <Band tone="error">{say(view.gateway)}</Band>}
        <IssueBands issues={issues} go={go} />
        <ImportOffers view={view} projects={state.projects} />
        <Tipped className="packages__manual" tip={t.packages.manualTip} align="start" focusable inline>
          {t.packages.manual}
        </Tipped>
        {groups.length === 0 ? (
          <EmptyState action={<AddPackage view={view} className="button button--primary" />}>{t.packages.empty}</EmptyState>
        ) : (
          groups.map((group) => (
            <GroupBox key={`${group.kind}:${group.marketplace ?? ''}`} group={group} column={t.packages.byDefault}>
              {group.packages.map((pkg) => (
                <CatalogLine
                  key={pkg.name}
                  pkg={pkg}
                  view={view}
                  open={open === pkg.name}
                  alert={issues.some((issue) => issue.name === pkg.name && !passes(issue.problem))}
                  onToggle={() => setOpen(open === pkg.name ? null : pkg.name)}
                />
              ))}
            </GroupBox>
          ))
        )}
      </Section>
      {loose.length > 0 && (
        <Section title={t.packages.looseKeys} hint={t.packages.looseKeysTip}>
          <KeyList keys={loose} titled={false} />
        </Section>
      )}
    </>
  )
}

/** Fetches the plugins' marketplaces again, once each, so the rows show the newer versions; it installs nothing. */
function CheckAll({ view }: { view: PackagesView }) {
  const { send, sending, failure } = useCommand()
  const any = view.packages.some((each) => each.installed && !each.removed)
  return (
    <>
      {failure !== null && <span className="packages__error">{say(failure)}</span>}
      <Tipped tip={t.packages.checkAllTip} inline>
        <button type="button" className="button button--small" disabled={sending || !any} onClick={() => void send('packages/check', {})}>
          {t.packages.checkAll}
        </button>
      </Tipped>
    </>
  )
}

/**
 * Presses every row's Install and Update in turn (EKR-127). A failed package does not stop the rest: a failed install
 * shows in its row; what the row does not show, as a marketplace that could not be fetched, stays here.
 */
function UpdateAll({ view }: { view: PackagesView }) {
  const { command } = useLive()
  const [running, setRunning] = useState(false)
  const [failures, setFailures] = useState<{ name: string; notice: Notice }[]>([])
  const pending = pendingCommands(view)
  const run = async () => {
    setRunning(true)
    setFailures([])
    const failed: { name: string; notice: Notice }[] = []
    for (const each of pending) {
      try {
        await command(each.command, { name: each.name })
      } catch (reason) {
        failed.push({ name: each.name, notice: noticeOf(reason) })
      }
    }
    setFailures(failed)
    setRunning(false)
  }
  const unshown = failures.filter((each) => view.packages.find((pkg) => pkg.name === each.name)?.error === null)
  return (
    <>
      {unshown.map((each) => (
        <span key={each.name} className="packages__error">
          {each.name}: {say(each.notice)}
        </span>
      ))}
      <Tipped tip={pending.length === 0 ? t.packages.updateAllNone : t.packages.updateAllTip} inline>
        <button type="button" className="button button--small" aria-busy={running || undefined} disabled={running || pending.length === 0} onClick={() => void run()}>
          {t.packages.updateAll}
        </button>
      </Tipped>
    </>
  )
}

function CatalogLine({ pkg, view, open, alert, onToggle }: { pkg: PackageView; view: PackagesView; open: boolean; alert: boolean; onToggle: () => void }) {
  const { send, sending, failure } = useCommand()
  const broken = rowNeedsInstall(pkg)
  const aside = pkg.removed ? null : (
    <>
      {!pkg.installing && broken && (
        <button type="button" className="button button--small" disabled={sending} onClick={() => void send('packages/install', { name: pkg.name })}>
          {t.packages.install}
        </button>
      )}
      {!pkg.installing && !broken && pkg.latest !== null && (
        <button type="button" className="button button--small packages__update" aria-label={t.packages.updateTo(pkg.latest)} disabled={sending} onClick={() => void send('packages/update', { name: pkg.name })}>
          {t.packages.update}
        </button>
      )}
      {pkg.builtIn ? (
        <BuiltInTag />
      ) : (
        <Tipped tip={t.packages.byDefaultTip} inline>
          <Switch checked={pkg.default} disabled={sending} label={t.packages.byDefaultLabel(pkg.name)} onChange={(on) => void send('packages/default', { name: pkg.name, on })} />
        </Tipped>
      )}
    </>
  )

  return (
    <PackageLine pkg={pkg} id={rowId(SCOPE, pkg.name)} open={open} alert={alert} onToggle={onToggle} aside={aside}>
      {() => (
        <>
          <PackageBrings pkg={pkg} />
          {pkg.error !== null && <p className="packages__error">{say(pkg.error)}</p>}
          {pkg.note !== null && <p className="packages__quiet">{say(pkg.note)}</p>}
          <PackageSettings pkg={pkg} />
          {!pkg.removed && <ScriptsSwitch pkg={pkg} disabled={sending} onChange={(on) => void send('packages/scripts', { name: pkg.name, on })} />}
          <KeyList keys={packageKeys(view, pkg.name)} />
          {!pkg.removed && (
            <div className="packages__details-actions">
              {pkg.installed && !pkg.installing && pkg.latest === null && (
                <Tipped tip={checkTip(pkg)} inline>
                  <button type="button" className="button button--small" disabled={sending} onClick={() => void send('packages/update', { name: pkg.name })}>
                    {t.packages.check}
                  </button>
                </Tipped>
              )}
              {!pkg.builtIn && (
                <button type="button" className="button button--small button--danger" disabled={sending} onClick={() => void send('packages/remove', { name: pkg.name })}>
                  {t.packages.remove}
                </button>
              )}
            </div>
          )}
          {failure !== null && <p className="packages__error">{say(failure)}</p>}
        </>
      )}
    </PackageLine>
  )
}

function checkTip(pkg: PackageView): string {
  if (pkg.kind === 'mcp') return t.packages.checkTip.mcp
  return pkg.fetched === null ? t.packages.checkTip.folder : t.packages.checkTip.fetched(formatAgo(pkg.fetched, new Date()))
}
