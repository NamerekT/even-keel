#!/usr/bin/env node
// PreToolUse guard for Huly writes: refuses markdown that puts inline code inside
// another mark, which the server accepts and Huly's editor then cannot open.
import { readFileSync } from "node:fs";
import { offendersIn } from "./marks.mjs";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const offenders = offendersIn(input?.tool_input);
if (offenders.length > 0) {
  process.stderr.write(
    "Not sent: Huly's editor cannot open inline code inside bold, italics, strikethrough or a link " +
      "(RangeError: Invalid collection of marks), and the user could no longer edit the text. " +
      "Move the code outside the mark — `**text** `code`` instead of `**text `code`**` — and call the tool again. Found:\n" +
      offenders.map((fragment) => `- ${fragment}`).join("\n") +
      "\n",
  );
  process.exit(2);
}
