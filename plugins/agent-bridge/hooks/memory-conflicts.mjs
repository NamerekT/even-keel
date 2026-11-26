#!/usr/bin/env node
// A record of the project memory changed on the same lines on two machines (BTN-1686): Even Keel's sync keeps the
// newer version in the file and lists the open conflicts, with the other version, in the memory folder's
// `.git/even-keel-conflicts.json` (`CONFLICTS_FILE`, src/memory/git/conflicts.ts). A read or an edit of a file of that
// folder brings them into the context: every one at the first touch in the session, one again whenever its own file is
// touched, until the record is saved after the conflict. A save that leaves the text as it was is marked in
// `.git/even-keel-saved.json` for the next sync to end the conflict (BTN-1746). It reads only the local folder, so it
// works without the hub.
// The global configuration's copy `~/.claude-config` (BTN-1690) keeps its conflicts the same way, its files in subfolders.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contextOutput } from "./evenkeel.mjs";

export const CONFLICTS_FILE = join(".git", "even-keel-conflicts.json");
/** The conflicts sessions saved with the text unchanged (BTN-1746): `SAVED_FILE` of src/memory/git/conflicts.ts. */
export const SAVED_FILE = join(".git", "even-keel-saved.json");
const SAVES = new Set(["Edit", "Write", "MultiEdit"]);
const MARKS_DIR = join(tmpdir(), "even-keel-memory-conflicts");

const hashOf = (text) => createHash("sha256").update(text).digest("hex");

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function savedIn(folder) {
  const saved = readJson(join(folder, SAVED_FILE), { saved: [] }).saved;
  return Array.isArray(saved) ? saved : [];
}

/**
 * The open conflicts of the folder whose file is still as the conflict left it and not saved since (`SAVED_FILE`);
 * a person's ones (`human`) are not a session's.
 */
export function pendingIn(folder) {
  const conflicts = readJson(join(folder, CONFLICTS_FILE), { conflicts: [] }).conflicts;
  if (!Array.isArray(conflicts)) return [];
  const saved = savedIn(folder);
  return conflicts.filter((conflict) => {
    if (conflict.human === true) return false;
    if (saved.some((mark) => mark?.file === conflict.file && mark?.hash === conflict.hash)) return false;
    try {
      return typeof conflict.note === "string" && hashOf(readFileSync(join(folder, conflict.file), "utf8")) === conflict.hash;
    } catch {
      return false;
    }
  });
}

/** A save that left the file of an open conflict as it was: marked, so Even Keel's next sync ends the conflict. */
function markSaved(folder, file) {
  const conflict = pendingIn(folder).find((each) => resolve(folder, each.file) === file);
  if (conflict === undefined) return;
  writeFileSync(join(folder, SAVED_FILE), JSON.stringify({ saved: [...savedIn(folder), { file: conflict.file, hash: conflict.hash }] }));
}

/** The path with every link resolved; a file not made yet — through its nearest existing folder. */
function realOf(path) {
  let rest = "";
  for (let at = path; ; ) {
    try {
      return join(realpathSync(at), rest);
    } catch {
      const up = dirname(at);
      if (up === at) return path;
      rest = join(basename(at), rest);
      at = up;
    }
  }
}

/**
 * The working copy a file lies in: the first folder up from its real path with a `.git`. A skill opened through
 * `~/.claude/skills/<name>` or an account folder's link lies in the global configuration's copy (BTN-1690).
 */
function folderOf(file) {
  for (let at = dirname(file); ; ) {
    if (existsSync(join(at, ".git"))) return at;
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/**
 * The text for the context of this tool call, or null; `marks` keeps what the session was told. A save done (after an
 * edit tool) says nothing: it ends its file's conflict, by a commit when it changed the text, else by `markSaved`.
 */
export function conflictsFor(input, marksDir = MARKS_DIR) {
  const path = input?.tool_input?.file_path;
  if (typeof path !== "string" || path === "" || typeof input.session_id !== "string") return null;
  const file = realOf(resolve(input.cwd || ".", path));
  const folder = folderOf(file);
  if (folder === null) return null;
  if (input.hook_event_name === "PostToolUse" && SAVES.has(input.tool_name)) {
    markSaved(folder, file);
    return null;
  }
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
