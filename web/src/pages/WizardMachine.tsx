import { t } from '../i18n/index.js'
import { useMachines } from '../layout/AddMachineDialog.js'
import { Select } from '../ui/Select.js'
import type { WizardFields } from './projectWizard.js'
import { Row } from './settingsParts.js'

/**
 * The wizard's machine of a git project (BTN-1271): this one or a joined machine elsewhere, where the project is cloned
 * once it is made here. Hidden while the hub has no machine elsewhere.
 */
export function WizardMachine({ fields, set }: { fields: WizardFields; set: (change: Partial<WizardFields>) => void }) {
  const joined = (useMachines() ?? []).filter((machine) => machine.joinedAt !== null && machine.revokedAt === null)
  if (!fields.git || joined.length === 0) return null
  const options = [
    { value: '', label: t.pool.wizard.here },
    ...joined.map((machine) => ({ value: machine.id, label: machine.online ? machine.name : `${machine.name} · ${t.pool.offline}` })),
  ]
  return (
    <Row
      className="settings__field project-add__pick"
      label={t.pool.wizard.machine}
      htmlFor="wizard-machine"
      control={<Select id="wizard-machine" className="settings__text" label={t.pool.wizard.machine} value={fields.machine} options={options} onChange={(machine) => set({ machine })} />}
    >
      <span className="settings__hint">{t.pool.wizard.hint}</span>
    </Row>
  )
}
