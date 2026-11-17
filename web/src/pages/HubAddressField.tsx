import { useEffect, useState } from 'react'
import type { AddressChoice } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { SuggestField, type Offer } from '../ui/SuggestField.js'

/**
 * The names the hub offers for "Hub address for machines" (BTN-1242), read once the field is shown, off the top bar:
 * `null` while read, so the field opened meanwhile shows its loader (BTN-1257).
 */
function useAddressOffers(): Offer[] | null {
  const { read } = useLive()
  const [choices, setChoices] = useState<AddressChoice[] | null>(null)
  useEffect(() => {
    let live = true
    read<AddressChoice[]>('machines/addresses', {}).then(
      (found) => live && setChoices(found),
      () => live && setChoices([]),
    )
    return () => {
      live = false
    }
  }, [])
  return choices?.map((choice) => ({
    value: choice.address,
    label: choice.adapter === undefined ? (t.shared.machinesAddressFrom[choice.from] ?? choice.from) : t.shared.machinesAddressAdapter(choice.adapter),
  })) ?? null
}

interface HubAddressFieldProps {
  id: string
  value: string
  invalid: boolean
  onChange: (value: string) => void
  /** The settings' "Machines do not connect" by default; the window that adds a machine asks for an address instead. */
  placeholder?: string
}

/** Typed freely — an IP, a name, a port after it — with the page's names and the network cards' addresses offered. */
export function HubAddressField({ id, value, invalid, onChange, placeholder = t.shared.machinesAddressNone }: HubAddressFieldProps) {
  const offers = useAddressOffers()
  return (
    <SuggestField
      id={id}
      className="settings__text settings__text--mono"
      mono
      value={value}
      options={offers ?? []}
      loading={offers === null}
      placeholder={placeholder}
      invalid={invalid}
      onChange={onChange}
    />
  )
}
