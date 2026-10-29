import { useLayoutEffect, useRef } from 'react'
import { useMatch } from 'react-router'
import { SETUP } from '../pages/setupSteps.js'
import { CliVersionBanner } from './CliVersionBanner.js'
import { CliCopiesBanner } from './CliCopies.js'
import { ConfigBanner } from './ConfigBanner.js'
import { Header } from './Header.js'
import { LinkBanner } from './LinkBanner.js'
import { PackagesBanner } from './PackagesBanner.js'
import { UnattendedBanner } from './UnattendedBanner.js'
import { UsageBanner } from './UsageBanner.js'

/** One measured sticky stack: all viewport-bound panels inherit its height, including during banner motion. */
export function AppHeader() {
  const setup = useMatch(SETUP) !== null
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current!
    const app = element.parentElement!
    const measure = () => app.style.setProperty('--header-height', `${element.getBoundingClientRect().height}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
      app.style.removeProperty('--header-height')
    }
  }, [])

  return (
    <div className="app__header" ref={ref}>
      <Header />
      <div className="app__banners">
        <LinkBanner />
        {!setup && <>
          <UsageBanner />
          <CliVersionBanner />
          <CliCopiesBanner />
        </>}
        <ConfigBanner />
        <UnattendedBanner />
        <PackagesBanner />
      </div>
    </div>
  )
}
