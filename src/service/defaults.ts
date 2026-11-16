export const SESSION_POLL_MS = 3_000
/** How often the CLI and the account's settings are looked at for a context window that may have changed. */
export const WINDOW_RECHECK_MS = 60_000
export const AGENT_TIMEOUT_MS = 30_000
export const CHANGELOG_TIMEOUT_MS = 10 * 60_000
export const LIMITS_POLL_MS = 2_000
export const USAGE_POLL_MS = 5 * 60_000
export const OFFLINE_RETRY_MS = 30_000
export const NETWORK_PROBE_MS = 5_000
export const LAUNCH_CHART_DAYS = 14
export const FALLBACK_TOAST_MS = 24 * 60 * 60_000
export const ACCOUNT_POLL_MS = 60_000
/** How often a release project's branch is looked at for commits the branch it merges into lacks (BTN-172). */
export const FORWARD_TICK_MS = 60_000
/** A project's task folders are read at most once per `WORK_TTL_MS`; the tick only lets a project read just now wait less. */
export const WORK_TICK_MS = 15_000
export const WORK_TTL_MS = 60_000
/** How often the labelled GitHub issues and the ones taken in are looked at (BTN-262). */
export const INTAKE_TICK_MS = 2 * 60_000
export const LIMIT_CHECK_MS = 30_000
export const OWNERS_RESCAN_MS = 5 * 60_000
export const CONFIG_POLL_MS = 2_000
export const TRACKER_CHECK_MS = 15_000
export const TALLY_INTERVAL_MS = 5 * 60_000
export const TALLY_FIRST_DELAY_MS = 15_000
export const SHUTDOWN_MS = 15_000
export const CI_TICK_MS = 5_000
export const CI_TARGETS_MS = 60_000
export const CI_TIMEOUT_MS = 15_000
export const UPDATE_POLL_MS = 12 * 60 * 60_000
export const CLI_VERSION_POLL_MS = 15 * 60_000
export const PLUGIN_UPDATE_TIMEOUT_MS = 2 * 60_000
