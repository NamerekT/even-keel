// The project's standards (BTN-359): a document of the repository that guards some of its files. A session gets the
// document after its first read of such a file, and its first edit of one is refused with the document while the
// session has not had it; the marks of what was given are kept per session and forgotten at a compaction. A standard
// with `shots` also holds the merge (in PR mode, the turn's PULL REQUEST mark) of a branch that changed its files until
// `.temp/shot/` has pictures newer than the last such change and `.temp/<document>-check.md`, newer than the pictures,
// answers every question of the document's section "The check". A standard is `{ doc, files, except, shots }`, the
// masks relative to the repository's root.
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative } from "node:path";

const READS = new Set(["Read", "read", "view", "read_file"]);
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "edit", "write", "multiedit", "create", "str_replace", "apply_patch", "patch"]);
const PATH_FIELDS = ["file_path", "filePath", "notebook_path", "path"];
const PATCH_FILE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm;
const PICTURES = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const SHOTS = ".temp/shot";
const PULL_REQUEST_LINE = /^[`*_]*PULL REQUEST:[`*_]*\s*[`*_]*([^`*\s][^`*]*?)[`*_]*$/;

const posix = (path) => path.replace(/\\/g, "/");

function globRegex(glob) {
  let source = "";
  const text = posix(glob.trim()).replace(/^\.\//, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "*" && text[i + 1] === "*") {
      const slash = text[i + 2] === "/";
      source += slash ? "(?:[^/]*/)*" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

const matchesAny = (globs, file) => (globs ?? []).some((glob) => typeof glob === "string" && glob.trim() !== "" && globRegex(glob).test(file));

/** Whether the standard guards `file`, a path relative to the repository's root. */
export function guards(standard, file) {
  const path = posix(file);
  return matchesAny(standard.files, path) && !matchesAny(standard.except, path);
}

/** `{ kind: "read" | "edit", paths }` of a tool call of any agent, or null for any other call. */
export function callOf(tool, input) {
  const kind = READS.has(tool) ? "read" : EDITS.has(tool) ? "edit" : null;
  if (kind === null || typeof input !== "object" || input === null) return null;
  const path = PATH_FIELDS.map((field) => input[field]).find((value) => typeof value === "string" && value !== "");
  if (path !== undefined) return { kind, paths: [path] };
  const patch = Object.values(input).find((value) => typeof value === "string" && value.includes("*** Begin Patch"));
  if (patch === undefined) return null;
  return { kind, paths: [...patch.matchAll(PATCH_FILE)].map((match) => match[1].trim()) };
}

/** Whether the call is one the standards look at at this moment: a read "after" it, an edit "before" it. */
export const due = (moment, call) => call !== null && (moment === "after") === (call.kind === "read");

/** The path relative to the repository's root, or null outside it. */
function inRoot(root, path) {
  const rel = posix(isAbsolute(path) ? relative(root, path) : path);
  return rel === "" || rel.startsWith("../") || isAbsolute(rel) ? null : rel.replace(/^\.\//, "");
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Where the answers to the document's check go: `.temp/<its name>-check.md`. */
export function answersFile(standard) {
  const name = basename(posix(standard.doc));
  return `.temp/${name.slice(0, name.length - extname(name).length) || name}-check.md`;
}

function mergeNote(standard) {
  if (!standard.shots) return "";
  return (
    `\n\nBefore the merge Even Keel wants, for the changed files of this standard, shots in \`${SHOTS}/\` taken after the last change ` +
    `and \`${answersFile(standard)}\` written after the shots, with each question of the document's section "The check" and its answer.`
  );
}

/**
 * What a tool call gets from the project's standards: `{ give }` — the text to add after a read, `{ deny }` — the
 * reason to refuse an edit, or null. `moment` is "after" or "before" the call; `marks` has `has(doc)` and `add(doc)`.
 */
export function standardsAt(moment, tool, input, root, standards, marks) {
  const call = callOf(tool, input);
  if (!due(moment, call)) return null;
  const owed = new Map();
  for (const path of call.paths) {
    const file = inRoot(root, path);
    if (file === null) continue;
    for (const standard of standards) {
      if (owed.has(standard.doc) || marks.has(standard.doc) || !guards(standard, file)) continue;
      const text = readText(join(root, standard.doc));
      if (text !== null) owed.set(standard.doc, { standard, file, text });
    }
  }
  if (owed.size === 0) return null;
  const parts = [...owed.values()].map(({ standard, file, text }) => {
    marks.add(standard.doc);
    const lead =
      call.kind === "read"
        ? `\`${file}\` falls under the project's standard \`${standard.doc}\`. Follow it in any change of such files; it is below, so there is no need to read it again.`
        : `Not yet: \`${file}\` falls under the project's standard \`${standard.doc}\`, which this session has not had. Read it below, plan the change by it, then make the edit again.`;
    return `${lead}${mergeNote(standard)}\n\n<standard path="${standard.doc}">\n${text.trimEnd()}\n</standard>`;
  });
  return call.kind === "read" ? { give: parts.join("\n\n") } : { deny: parts.join("\n\n") };
}

const markFile = (dir, session, agent) => join(dir, `${[session, agent].filter(Boolean).join(".").replace(/[^\w.-]/g, "_")}.standards.json`);

/** The documents a session (or one of its subagents) has had, kept in `dir`. */
export function givenStore(dir, session, agent) {
  const file = markFile(dir, session, agent);
  const read = () => {
    try {
      const given = JSON.parse(readFileSync(file, "utf8")).given;
      return Array.isArray(given) ? given : [];
    } catch {
      return [];
    }
  };
  return {
    has: (doc) => read().includes(doc),
    add: (doc) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify({ given: [...new Set([...read(), doc])] }));
    },
  };
}

/** A compaction drops what the session was given, so the documents come again. */
export function clearGiven(dir, session) {
  rmSync(markFile(dir, session), { force: true });
}

/** The questions of the document's section "The check": its list items that end with "?". */
export function checkQuestions(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,6}\s+the check\s*$/i.test(line.trim()));
  if (start < 0) return [];
  const level = lines[start].trim().match(/^#+/)[0].length;
  const questions = [];
  for (const line of lines.slice(start + 1)) {
    const heading = line.match(/^(#{1,6})\s/);
    if (heading !== null && heading[1].length <= level) break;
    const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*\?)\s*$/);
    if (item !== null) questions.push(item[1].trim());
  }
  return questions;
}

const plain = (text) => text.replace(/[*_`>#]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** The questions the answers do not hold, or hold with nothing after them up to the next question. */
export function missingAnswers(questions, answers) {
  const text = plain(String(answers ?? "").replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, " "));
  const found = questions.map((question) => ({ question, at: text.indexOf(plain(question)), length: plain(question).length }));
  return found
    .filter(({ at, length }) => {
      if (at < 0) return true;
      const next = found.map((other) => other.at).filter((other) => other > at).sort((a, b) => a - b)[0] ?? text.length;
      return !/\w/.test(text.slice(at + length, next));
    })
    .map(({ question }) => question);
}

/** Whether a turn's last message ends with PR mode's mark: there the push of the branch stands for the merge. */
export function wantsPullRequest(message) {
  const last = String(message ?? "").trimEnd().split("\n").pop() ?? "";
  return PULL_REQUEST_LINE.test(last.trim());
}

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, encoding: "utf8", windowsHide: true }, (error, stdout) => resolve(error ? null : stdout));
  });
}

const mtime = (file) => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
};

function newestPicture(dir) {
  let newest = null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const at = entry.isDirectory() ? newestPicture(path) : PICTURES.has(extname(entry.name).toLowerCase()) ? mtime(path) : null;
    if (at !== null && (newest === null || at > newest)) newest = at;
  }
  return newest;
}

/** What one standard still lacks before the merge, as lines; empty — nothing. */
function lacking(root, standard, changed) {
  const files = changed.filter((file) => guards(standard, file));
  if (files.length === 0) return [];
  const edited = Math.max(0, ...files.map((file) => mtime(join(root, file)) ?? 0));
  const shot = newestPicture(join(root, SHOTS));
  if (shot === null) return [`no shots in \`${SHOTS}/\`: take them (\`npm run shot\` or the project's own way) of every screen the branch changed`];
  if (shot <= edited) return [`the shots in \`${SHOTS}/\` are older than the last change of ${files.map((file) => `\`${file}\``).join(", ")}: take them again`];
  const questions = checkQuestions(readText(join(root, standard.doc)));
  if (questions.length === 0) return [];
  const answers = answersFile(standard);
  const list = (missing) => missing.map((question) => `  - ${question}`).join("\n");
  const written = mtime(join(root, answers));
  if (written === null) return [`no \`${answers}\`: look at the shots and write each question of "The check" with its answer:\n${list(questions)}`];
  if (written <= shot) return [`\`${answers}\` was written before the shots: look at the new ones and answer again`];
  const missing = missingAnswers(questions, readText(join(root, answers)));
  return missing.length === 0 ? [] : [`\`${answers}\` has no answer to:\n${list(missing)}`];
}

/**
 * The text that stops the merge of the branch at `root` into `main` (`pull` — in PR mode, the turn that hands it to its
 * pull request) while a standard with `shots` whose files the branch changed lacks its shots or answers, or null. A
 * git that cannot tell lets the merge go.
 */
export async function standardsRefusal(root, main, standards, pull = false) {
  const checked = (standards ?? []).filter((standard) => standard.shots);
  if (checked.length === 0) return null;
  const diff = await git(root, ["diff", "--name-only", `${main}...HEAD`]);
  if (diff === null) return null;
  const changed = diff.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
  const parts = checked.flatMap((standard) => lacking(root, standard, changed).map((line) => `- \`${standard.doc}\`: ${line}`));
  if (parts.length === 0) return null;
  const stopped = pull ? "keeps the branch from its pull request" : "stopped the merge";
  const again = pull ? "end the turn with the PULL REQUEST line again" : "merge again";
  return (
    `Even Keel's check of the project's standards ${stopped}: the branch changed files a standard guards, ` +
    "and its check is not done.\n\n" +
    parts.join("\n") +
    `\n\nA "no" among the answers is fixed first, not noted. Then ${again}.\n`
  );
}
