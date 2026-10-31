import { t } from '../i18n/index.js'
import { SlidersIcon } from '../ui/icons.js'
import { SEG_CLASS, type ChipLook } from './chipLook.js'
import { UnsavedDot } from './settingsParts.js'

const CHIP_CLASS: Record<ChipLook, string> = { tag: 'tag tag--settings', tab: 'side-tab side-tab--wide', seg: SEG_CLASS }

export function SettingsChip({ open, look = 'tag', dirty, onToggle }: { open: boolean; look?: ChipLook; dirty: boolean; onToggle: () => void }) {
  const seg = look === 'seg'
  return (
    <button
      type="button"
      className={CHIP_CLASS[look]}
      aria-expanded={open}
      aria-label={seg ? t.settings.open : undefined}
      title={t.settings.title}
      onClick={onToggle}
    >
      <SlidersIcon />
      {!seg && t.settings.open}
      {dirty && <UnsavedDot />}
    </button>
  )
}
