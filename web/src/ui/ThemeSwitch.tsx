import type { ReactNode } from 'react'
import { t } from '../i18n/index.js'
import { Segmented } from '../stats/common.js'
import { setThemeChoice, THEME_CHOICES, useThemeChoice, type ThemeChoice } from '../theme.js'
import { MoonIcon, SunIcon, SystemThemeIcon } from './icons.js'
import '../stats/overview.css'

const ICONS: Record<ThemeChoice, ReactNode> = { system: <SystemThemeIcon />, light: <SunIcon />, dark: <MoonIcon /> }

/** The page's theme in this browser (BTN-1089): with words in the settings, icons alone in the gear's menu. */
export function ThemeSwitch({ words = false }: { words?: boolean }) {
  const choice = useThemeChoice()
  const options = THEME_CHOICES.map((each): [ThemeChoice, ReactNode, string?] =>
    words
      ? [
          each,
          <>
            {ICONS[each]}
            {t.shared.themes[each]}
          </>,
        ]
      : [each, ICONS[each], t.shared.themes[each]],
  )
  return <Segmented label={t.shared.theme} options={options} value={choice} onChange={setThemeChoice} />
}
