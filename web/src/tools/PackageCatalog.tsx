import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { EvenKeelState, PackagesView, PackageView } from '../../../src/state.js'
import { formatAgo } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { Section, Switch } from '../pages/settingsParts.js'
import { Band, EmptyState } from '../ui/blocks.js'
import { Tipped } from '../ui/Tipped.js'
import { AddPackage } from './AddPackage.js'
import { catalogIssues, looseKeys, PACKAGE_PARAM, packageGroups, packageKeys } from './packageGroups.js'
import { GroupBox, ImportOffers, IssueBands, KeyList, PackageBrings, PackageLine, PackageSettings, rowId } from './PackagesParts.js'
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
                  alert={issues.some((issue) => issue.name === pkg.name)}
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

/** Fetches the marketplaces again for every installed package, one after another, as each row's Check does. */
function CheckAll({ view }: { view: PackagesView }) {
  const { send, sending, failure } = useCommand()
  const names = view.packages.filter((each) => each.installed && !each.removed && !each.installing && each.error === null).map((each) => each.name)
  const run = async () => {
    for (const name of names) if (!(await send('packages/update', { name }))) return
  }
  return (
    <>
      {failure !== null && <span className="packages__error">{say(failure)}</span>}
      <Tipped tip={t.packages.checkAllTip} inline>
        <button type="button" className="button button--small" disabled={sending || names.length === 0} onClick={() => void run()}>
          {t.packages.checkAll}
        </button>
      </Tipped>
    </>
  )
}

function CatalogLine({ pkg, view, open, alert, onToggle }: { pkg: PackageView; view: PackagesView; open: boolean; alert: boolean; onToggle: () => void }) {
  const { send, sending, failure } = useCommand()
  const broken = !pkg.installed || pkg.error !== null
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
      <Tipped tip={t.packages.byDefaultTip} inline>
        <Switch checked={pkg.default} disabled={sending} label={t.packages.byDefaultLabel(pkg.name)} onChange={(on) => void send('packages/default', { name: pkg.name, on })} />
      </Tipped>
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
              <button type="button" className="button button--small button--danger" disabled={sending} onClick={() => void send('packages/remove', { name: pkg.name })}>
                {t.packages.remove}
              </button>
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
