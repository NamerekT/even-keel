import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadEnv } from '../locations.js'
import { accountsRoot } from './homes.js'
import { removeAccountSettingsGuards } from './settingsGuard.js'

loadEnv()
removeAccountSettingsGuards(accountsRoot(process.env), process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'))
