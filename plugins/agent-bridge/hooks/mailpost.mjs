// The chat's messages for an OpenCode session (../opencode/agent-bridge.mjs, BTN-1323): what waits is posted into the
// session as the user's own line by `client.session.promptAsync`, which the running `opencode run` takes on its next
// step of the same turn (seen live on 1.19.5). The text part carries `metadata.evenKeel.mail`, by which Even Keel's feed
// tells it from a turn's prompt. Mail is asked after each tool call and, while the session is busy, every two seconds,
// so a message that comes during the turn's last text step still reaches that turn. One question at a time a session:
// the next goes only after the previous one's answer. A subagent's session is unknown to Even Keel and gets nothing.

export const MAIL_POLL_MS = 2000;

/** `mailOf(sessionID, event)` — the text that waits, or null; `clock` — `setTimeout` and `clearTimeout`. */
export function mailPost({ client, mailOf, clock = globalThis }) {
  const queues = new Map();
  const timers = new Map();

  // Async, so that a missing client or one throwing at once becomes a rejection the caller catches.
  const post = async (id, text) =>
    client.session.promptAsync({ path: { id }, body: { parts: [{ type: "text", text, metadata: { evenKeel: { mail: text } } }] } });

  // No Even Keel, no answer in time or OpenCode refusing the post must never break the tool call or the poll.
  const ask = (id) => {
    const queued = (queues.get(id) ?? Promise.resolve()).then(async () => {
      const mail = await mailOf(id, "PostToolUse").catch(() => null);
      if (mail !== null) await post(id, mail).catch(() => {});
    });
    queues.set(id, queued);
    void queued.then(() => {
      if (queues.get(id) === queued) queues.delete(id);
    });
    return queued;
  };

  const schedule = (id) => {
    const timer = clock.setTimeout(() => {
      void ask(id).then(() => {
        if (timers.get(id) === timer) schedule(id);
      });
    }, MAIL_POLL_MS);
    timer?.unref?.();
    timers.set(id, timer);
  };

  return {
    afterTool: (id) => ask(id),
    /** The session's `session.status`: `idle` stops its poll, any other starts it once. */
    status: (id, type) => {
      if (type === "idle") {
        clock.clearTimeout(timers.get(id));
        timers.delete(id);
      } else if (!timers.has(id)) schedule(id);
    },
  };
}
