import { t } from '../i18n/index.js'
import { SlidersIcon } from '../ui/icons.js'
import { SEG_CLASS, type ChipLook } from './chipLook.js'
import { UnsavedDot } from './settingsParts.js'

// Over the side column it is an icon only, so that the Chats tab and the help fit a 400 px column (BTN-1231).
const CHIP_CLASS: Record<ChipLook, string> = { tag: 'tag tag--settings', tab: 'side-tab side-tab--icon', seg: SEG_CLASS }

export function SettingsChip({ open, look = 'tag', dirty, onToggle }: { open: boolean; look?: ChipLook; dirty: boolean; onToggle: () => void }) {
  const bare = look !== 'tag'
  return (
    <button
      type="button"
      className={CHIP_CLASS[look]}
      aria-expanded={open}
      aria-label={bare ? t.settings.open : undefined}
      title={t.settings.title}
      onClick={onToggle}
    >
      <SlidersIcon />
      {!bare && t.settings.open}
      {dirty && <UnsavedDot />}
    </button>
  )
}
