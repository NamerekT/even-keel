// Where Even Keel's checkout is, for the launcher (./sql.mjs): Tally's query script and the `pg` and `.env` it needs
// live there, not in the plugin.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const DEFAULT_URL = "http://127.0.0.1:4747";

const scriptOf = (checkout) => join(checkout, "tally", "bin", "sql.mjs");
// The config tells Tally from this plugin, whose own folder is `tally/` with a `bin/sql.mjs` too.
const isCheckout = (dir, exists) => exists(scriptOf(dir)) && exists(join(dir, "tally", "tally.config.json"));

/** The nearest folder at or above `here` with Tally's query script, or null. */
export function checkoutAbove(here, exists = existsSync) {
  for (let dir = here; ; dir = dirname(dir)) {
    if (isCheckout(dir, exists)) return dir;
    if (dirname(dir) === dir) return null;
  }
}

async function fetchStateOf(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Even Keel's checkout: `EVEN_KEEL_HOME`; else the folder above the plugin (Even Keel copies a package into its own
 * `state/`, and the source is in `plugins/`); else the checkout the running service reports (`EVEN_KEEL_URL`).
 */
export async function findCheckout({ env = process.env, here, exists = existsSync, fetchState = fetchStateOf }) {
  if (env.EVEN_KEEL_HOME) {
    if (isCheckout(env.EVEN_KEEL_HOME, exists)) return env.EVEN_KEEL_HOME;
    throw new Error(`EVEN_KEEL_HOME is ${env.EVEN_KEEL_HOME}, and there is no ${scriptOf(env.EVEN_KEEL_HOME)}`);
  }
  const above = checkoutAbove(here, exists);
  if (above !== null) return above;
  const url = `${(env.EVEN_KEEL_URL || DEFAULT_URL).replace(/\/+$/, "")}/api/state`;
  let dir;
  try {
    dir = (await fetchState(url))?.packages?.marketplace?.dir;
  } catch (error) {
    throw new Error(`Even Keel's checkout not found: set EVEN_KEEL_HOME to it, or start Even Keel (${url}: ${error.message})`);
  }
  if (typeof dir === "string" && isCheckout(dir, exists)) return dir;
  throw new Error(`Even Keel's checkout not found: set EVEN_KEEL_HOME to it (${url} names none with Tally)`);
}

export { scriptOf };
