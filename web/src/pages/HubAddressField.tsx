import { useEffect, useState } from 'react'
import type { AddressChoice } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { SuggestField, type Offer } from '../ui/SuggestField.js'

/** The names the hub offers for "Hub address for machines" (BTN-1242), read once the field is shown. */
function useAddressOffers(): Offer[] {
  const { query } = useLive()
  const [choices, setChoices] = useState<AddressChoice[]>([])
  useEffect(() => {
    let live = true
    query<AddressChoice[]>('machines/addresses', {}).then(
      (read) => live && setChoices(read),
      () => live && setChoices([]),
    )
    return () => {
      live = false
    }
  }, [])
  return choices.map((choice) => ({
    value: choice.address,
    label: choice.adapter === undefined ? (t.shared.machinesAddressFrom[choice.from] ?? choice.from) : t.shared.machinesAddressAdapter(choice.adapter),
  }))
}

interface HubAddressFieldProps {
  id: string
  value: string
  invalid: boolean
  onChange: (value: string) => void
}

/** Typed freely — an IP, a name, a port after it — with the page's names and the network cards' addresses offered. */
export function HubAddressField({ id, value, invalid, onChange }: HubAddressFieldProps) {
  return (
    <SuggestField
      id={id}
      className="settings__text settings__text--mono"
      mono
      value={value}
      options={useAddressOffers()}
      placeholder={t.shared.machinesAddressNone}
      invalid={invalid}
      onChange={onChange}
    />
  )
}
