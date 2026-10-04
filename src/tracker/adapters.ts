import { huly } from '../huly/adapter.js'
import type { TrackerAdapter } from './source.js'

export const ADAPTERS: Readonly<Record<string, TrackerAdapter>> = { huly }

export const DEFAULT_TRACKER = 'huly'

export const trackerVariables = (): string[] => Object.values(ADAPTERS).flatMap((adapter) => adapter.variables)
