#!/usr/bin/env node
// Runs Tally's read-only query script from Even Keel's checkout with the same arguments and stdin:
// node sql.mjs [-n rows] [-w width] [--csv] ("<sql>" | -f file.sql | -).
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findCheckout, scriptOf } from "./locate.mjs";

let checkout;
try {
  checkout = await findCheckout({ here: dirname(fileURLToPath(import.meta.url)) });
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
const run = spawnSync(process.execPath, [scriptOf(checkout), ...process.argv.slice(2)], { stdio: "inherit" });
if (run.error) {
  process.stderr.write(`${run.error.message}\n`);
  process.exit(1);
}
process.exit(run.status ?? 1);
