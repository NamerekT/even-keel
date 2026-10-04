import { github } from '../github/adapter.js'
import { huly } from '../huly/adapter.js'
import type { TrackerAdapter } from './source.js'

export const ADAPTERS: Readonly<Record<string, TrackerAdapter>> = { huly, github }

export const DEFAULT_TRACKER = 'huly'

export const trackerVariables = (): string[] => Object.values(ADAPTERS).flatMap((adapter) => adapter.variables)
