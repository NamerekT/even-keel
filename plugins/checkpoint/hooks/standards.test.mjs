import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  answersFile,
  callOf,
  checkQuestions,
  clearGiven,
  givenStore,
  guards,
  missingAnswers,
  standardsAt,
  standardsRefusal,
  wantsPullRequest,
} from "./standards.mjs";

const design = { doc: "docs/design.md", files: ["web/src/**/*.tsx", "web/src/**/*.css"], except: ["**/*.test.*", "web/src/i18n/**"], shots: true };
const notes = { doc: "docs/notes.md", files: ["notes/*.md"], except: [], shots: false };

const DOC = [
  "# Design",
  "",
  "Some rules.",
  "",
  "## The check",
  "",
  "1. Shoot it.",
  "2. Answer every line:",
  "   - Is any part of the screen empty?",
  "   - Is there a `code` in the text a person reads?",
  "3. Name the shots.",
  "",
  "## After",
  "",
  "- Not a question?",
].join("\n");

function write(root, path, text, at) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  if (at !== undefined) utimesSync(file, at / 1000, at / 1000);
}

describe("guards", () => {
  it("matches the masks from the repository's root, and the exceptions win", () => {
    expect(guards(design, "web/src/pages/Panel.tsx")).toBe(true);
    expect(guards(design, "web/src/styles.css")).toBe(true);
    expect(guards(design, "web/src/pages/Panel.test.tsx")).toBe(false);
    expect(guards(design, "web/src/i18n/en.tsx")).toBe(false);
    expect(guards(design, "src/server.tsx")).toBe(false);
    expect(guards(design, "web/src/pages/Panel.ts")).toBe(false);
    expect(guards(notes, "notes/a.md")).toBe(true);
    expect(guards(notes, "notes/deep/a.md")).toBe(false);
  });

  it("takes `**/` for any depth, the root included, and `?` for one character", () => {
    const any = { doc: "d.md", files: ["**/*.vue", "a?.css"], except: [] };
    expect(guards(any, "App.vue")).toBe(true);
    expect(guards(any, "src/deep/App.vue")).toBe(true);
    expect(guards(any, "ab.css")).toBe(true);
    expect(guards(any, "abc.css")).toBe(false);
  });
});

describe("callOf", () => {
  it("reads the paths of the agents' read and edit tools", () => {
    expect(callOf("Read", { file_path: "D:\\repo\\a.tsx" })).toEqual({ kind: "read", paths: ["D:\\repo\\a.tsx"] });
    expect(callOf("Edit", { file_path: "a.tsx" })).toEqual({ kind: "edit", paths: ["a.tsx"] });
    expect(callOf("NotebookEdit", { notebook_path: "n.ipynb" })).toEqual({ kind: "edit", paths: ["n.ipynb"] });
    expect(callOf("read", { filePath: "a.tsx" })).toEqual({ kind: "read", paths: ["a.tsx"] });
    expect(callOf("view", { path: "a.tsx" })).toEqual({ kind: "read", paths: ["a.tsx"] });
    expect(callOf("Bash", { command: "cat a.tsx" })).toBeNull();
  });

  it("takes the files of a patch", () => {
    const patch = "*** Begin Patch\n*** Update File: web/src/a.tsx\n@@\n-x\n+y\n*** Add File: web/src/b.css\n+z\n*** End Patch";
    expect(callOf("apply_patch", { command: patch })).toEqual({ kind: "edit", paths: ["web/src/a.tsx", "web/src/b.css"] });
    expect(callOf("apply_patch", { input: patch }).paths).toHaveLength(2);
  });

  it("takes the files of a patch given as the whole input, as Copilot sends its apply_patch", () => {
    const patch = "*** Begin Patch\n*** Add File: notes/cp5.md\n+cp5 was here\n*** End Patch\n";
    expect(callOf("Edit", patch)).toEqual({ kind: "edit", paths: ["notes/cp5.md"] });
    expect(callOf("Edit", "notes/cp5.md")).toBeNull();
  });
});

describe("standardsAt", () => {
  let root;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "standards-"));
    write(root, "docs/design.md", DOC);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const marks = () => {
    const given = new Set();
    return { has: (doc) => given.has(doc), add: (doc) => given.add(doc), given };
  };

  it("gives the document after the first read of a guarded file, once", () => {
    const given = marks();
    const read = (path) => standardsAt("after", "Read", { file_path: join(root, path) }, root, [design, notes], given);
    const first = read("web/src/pages/Panel.tsx");
    expect(first).toMatchObject({ give: expect.stringContaining("## The check") });
    expect(first.give).toContain("web/src/pages/Panel.tsx");
    expect(first.give).toContain(".temp/design-check.md");
    expect(given.given).toEqual(new Set(["docs/design.md"]));
    expect(read("web/src/styles.css")).toBeNull();
  });

  it("refuses the first edit of a guarded file the session has no document for, then lets it through", () => {
    const given = marks();
    const edit = () => standardsAt("before", "Edit", { file_path: "web/src/pages/Panel.tsx" }, root, [design], given);
    expect(edit()).toMatchObject({ deny: expect.stringContaining("## The check") });
    expect(edit()).toBeNull();
  });

  it("leaves other files, other moments, a missing document and an outside path alone", () => {
    const given = marks();
    expect(standardsAt("after", "Read", { file_path: join(root, "src/server.ts") }, root, [design], given)).toBeNull();
    expect(standardsAt("before", "Read", { file_path: "web/src/a.tsx" }, root, [design], given)).toBeNull();
    expect(standardsAt("after", "Edit", { file_path: "web/src/a.tsx" }, root, [design], given)).toBeNull();
    expect(standardsAt("after", "Read", { file_path: "notes/a.md" }, root, [notes], given)).toBeNull();
    expect(standardsAt("after", "Read", { file_path: join(tmpdir(), "web/src/a.tsx") }, root, [design], given)).toBeNull();
    expect(given.given.size).toBe(0);
  });
});

describe("the marks of a session", () => {
  it("keeps what was given per session and forgets it", () => {
    const dir = mkdtempSync(join(tmpdir(), "standards-marks-"));
    try {
      const one = givenStore(dir, "s-1");
      one.add("docs/design.md");
      expect(givenStore(dir, "s-1").has("docs/design.md")).toBe(true);
      expect(givenStore(dir, "s-2").has("docs/design.md")).toBe(false);
      expect(givenStore(dir, "s-1", "agent-7").has("docs/design.md")).toBe(false);
      clearGiven(dir, "s-1");
      expect(givenStore(dir, "s-1").has("docs/design.md")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("checkQuestions and missingAnswers", () => {
  it("takes the questions of the section 'The check' only", () => {
    expect(checkQuestions(DOC)).toEqual(["Is any part of the screen empty?", "Is there a `code` in the text a person reads?"]);
    expect(checkQuestions("# Doc\n\n- Why?")).toEqual([]);
  });

  it("wants each question with an answer after it", () => {
    const questions = checkQuestions(DOC);
    const full = "- Is any part of the screen empty?\n  No: centred.\n- **Is there a `code` in the text a person reads?** No.";
    expect(missingAnswers(questions, full)).toEqual([]);
    expect(missingAnswers(questions, "- Is any part of the screen empty?\n- Is there a `code` in the text a person reads? No")).toEqual([questions[0]]);
    expect(missingAnswers(questions, "")).toEqual(questions);
  });

  it("names the answers file after the document", () => {
    expect(answersFile(design)).toBe(".temp/design-check.md");
    expect(answersFile({ doc: "STYLE" })).toBe(".temp/STYLE-check.md");
  });
});

describe("wantsPullRequest", () => {
  it("sees PR mode's mark on the last line", () => {
    expect(wantsPullRequest("Done.\n\nPULL REQUEST: .temp/pull-request.md")).toBe(true);
    expect(wantsPullRequest("**PULL REQUEST:** `.temp/pull-request.md`\n")).toBe(true);
    expect(wantsPullRequest("PULL REQUEST: .temp/pull-request.md\nmore")).toBe(false);
    expect(wantsPullRequest(undefined)).toBe(false);
  });
});

describe("standardsRefusal", () => {
  let repo;
  const hour = 3_600_000;
  const base = Date.now() - 10 * hour;
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "standards-merge-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "john@example.com");
    git("config", "user.name", "John Doe");
    write(repo, "docs/design.md", DOC);
    write(repo, "src/a.ts", "a");
    git("add", ".");
    git("commit", "-qm", "base");
    // Not `abc-12/task`: on Windows `rmSync` cannot remove a repository whose refs hold a folder.
    git("checkout", "-qb", "abc-12-task");
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("lets a branch through that changed no guarded file", async () => {
    write(repo, "src/a.ts", "b");
    git("commit", "-qam", "logic");
    expect(await standardsRefusal(repo, "main", [design])).toBeNull();
  });

  it("wants shots newer than the last edit and answers newer than the shots", async () => {
    write(repo, "web/src/Panel.tsx", "x", base + 2 * hour);
    git("add", ".");
    git("commit", "-qm", "screen");
    const none = await standardsRefusal(repo, "main", [design]);
    expect(none).toContain(".temp/shot/");
    expect(none).toContain("docs/design.md");

    write(repo, ".temp/shot/page/1-panel.png", "png", base + hour);
    expect(await standardsRefusal(repo, "main", [design])).toContain("older than");

    write(repo, ".temp/shot/page/1-panel.png", "png", base + 3 * hour);
    const unanswered = await standardsRefusal(repo, "main", [design]);
    expect(unanswered).toContain(".temp/design-check.md");
    expect(unanswered).toContain("Is any part of the screen empty?");

    const answers = "- Is any part of the screen empty? No.\n- Is there a `code` in the text a person reads? No.\n";
    write(repo, ".temp/design-check.md", answers, base + 2.5 * hour);
    expect(await standardsRefusal(repo, "main", [design])).toContain("before the shots");

    write(repo, ".temp/design-check.md", "- Is any part of the screen empty? No.\n", base + 4 * hour);
    expect(await standardsRefusal(repo, "main", [design])).toContain("Is there a `code` in the text a person reads?");

    write(repo, ".temp/design-check.md", answers, base + 4 * hour);
    expect(await standardsRefusal(repo, "main", [design])).toBeNull();
  });

  it("asks nothing of a standard without the merge check, and lets the merge go when git cannot tell", async () => {
    expect(await standardsRefusal(repo, "main", [{ ...design, shots: false }])).toBeNull();
    expect(await standardsRefusal(repo, "no-such-branch", [design])).toBeNull();
    expect(await standardsRefusal(tmpdir(), "main", [design])).toBeNull();
  });
});
