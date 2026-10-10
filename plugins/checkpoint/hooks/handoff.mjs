// Whether a turn wrote the handoff note at its very end but forgot the CHECKPOINT line,
// which leaves Even Keel waiting on a session that meant to hand off.

const MARK = /^[`*_]*CHECKPOINT:[`*_]*\s*[`*_]*([^`*\s][^`*]*?)[`*_]*$/;
const NOTE = /(^|\/)\.temp\/handoff\.md$/;
const WRITES = new Set(["Write", "Edit", "MultiEdit"]);
const NEAR_END = 3;

export function hasMark(text) {
  const last = (text ?? "").trimEnd().split("\n").pop() ?? "";
  return MARK.test(last.trim());
}

function blocksOf(content) {
  return Array.isArray(content) ? content : [];
}

function isPrompt(entry) {
  if (entry.type !== "user" || entry.isMeta) return false;
  const content = entry.message?.content;
  if (typeof content === "string") return content.trim() !== "";
  const blocks = blocksOf(content);
  return blocks.some((block) => block.type === "text") && !blocks.some((block) => block.type === "tool_result");
}

function isNote(toolUse) {
  const path = String(toolUse.input?.file_path ?? "").replace(/\\/g, "/");
  return WRITES.has(toolUse.name) && NOTE.test(path);
}

/** Tool calls of the main thread since the last prompt, oldest first. */
export function turnTools(entries) {
  let tools = [];
  for (const entry of entries) {
    if (entry.isSidechain) continue;
    if (isPrompt(entry)) tools = [];
    else if (entry.type === "assistant") tools.push(...blocksOf(entry.message?.content).filter((b) => b.type === "tool_use"));
  }
  return tools;
}

/** The turn wrote `.temp/handoff.md` among its last few tool calls and its last message lacks the mark. */
export function missingMark(entries, lastMessage) {
  const tail = turnTools(entries).slice(-NEAR_END);
  return tail.some(isNote) && !hasMark(lastMessage);
}
