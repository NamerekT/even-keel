#!/usr/bin/env node
// A record of the project memory changed on the same lines on two machines (BTN-1686): Even Keel's sync keeps the
// newer version in the file and lists the open conflicts, with the other version, in the memory folder's
// `.git/even-keel-conflicts.json` (`CONFLICTS_FILE`, src/memory/git/conflicts.ts). A read or an edit of a file of that
// folder brings them into the context: every one at the first touch in the session, one again whenever its own file is
// touched, until the record is saved after the conflict. It reads only the local folder, so it works without the hub.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contextOutput } from "./evenkeel.mjs";

export const CONFLICTS_FILE = join(".git", "even-keel-conflicts.json");
const MARKS_DIR = join(tmpdir(), "even-keel-memory-conflicts");

const hashOf = (text) => createHash("sha256").update(text).digest("hex");

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

/** The open conflicts of the folder whose file is still as the conflict left it. */
export function pendingIn(folder) {
  const conflicts = readJson(join(folder, CONFLICTS_FILE), { conflicts: [] }).conflicts;
  if (!Array.isArray(conflicts)) return [];
  return conflicts.filter((conflict) => {
    try {
      return typeof conflict.note === "string" && hashOf(readFileSync(join(folder, conflict.file), "utf8")) === conflict.hash;
    } catch {
      return false;
    }
  });
}

/** The text for the context of this tool call, or null; `marks` keeps what the session was told. */
export function conflictsFor(input, marksDir = MARKS_DIR) {
  const path = input?.tool_input?.file_path;
  if (typeof path !== "string" || path === "" || typeof input.session_id !== "string") return null;
  const file = resolve(input.cwd || ".", path);
  const folder = dirname(file);
  const pending = pendingIn(folder);
  if (pending.length === 0) return null;
  const marksFile = join(marksDir, `${input.session_id.replace(/[^\w.-]/g, "_")}.json`);
  const told = new Set(readJson(marksFile, []));
  const due = pending.filter((conflict) => {
    const key = `${folder}\0${conflict.file}\0${conflict.hash}`;
    const touched = resolve(folder, conflict.file) === file;
    if (told.has(key) && !touched) return false;
    told.add(key);
    return true;
  });
  if (due.length === 0) return null;
  try {
    mkdirSync(marksDir, { recursive: true });
    writeFileSync(marksFile, JSON.stringify([...told]));
  } catch {}
  return due.map((conflict) => conflict.note).join("\n\n");
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const text = conflictsFor(input);
  if (text !== null) process.stdout.write(JSON.stringify(contextOutput(input.hook_event_name, text)));
}

// A broken memory folder must never break the tool call.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch {}
}
