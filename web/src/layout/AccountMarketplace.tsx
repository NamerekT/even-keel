import type { PackagesView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { marketplaceCommand } from '../tools/packageView.js'
import { CommandBlock } from '../ui/blocks.js'
import { Tipped } from '../ui/Tipped.js'
import type { Send } from './accountParts.js'

/** Registration in the default Claude config, only for sessions started by hand. */
export function AccountMarketplace({ marketplace, send, sending }: { marketplace: NonNullable<PackagesView['marketplace']>; send: Send; sending: boolean }) {
  return <Tipped className="account-marketplace" focusable={marketplace.known} tip={<>
    <span>{t.account.marketplaceTip}</span>
    <CommandBlock command={marketplaceCommand(marketplace.dir)} />
    <CommandBlock command="claude plugin install huly@even-keel" />
  </>}>
    {marketplace.known ? <span className="account-marketplace__known">✓ {t.account.marketplace}</span> :
      <button type="button" className="button button--small" disabled={sending} onClick={() => void send('packages/marketplace', {})}>+ {t.account.marketplace}</button>}
  </Tipped>
}
