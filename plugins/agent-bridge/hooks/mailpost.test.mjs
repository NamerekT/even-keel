import { describe, expect, it } from "vitest";
import { MAIL_POLL_MS, mailPost } from "./mailpost.mjs";

/** Timers run by hand: `tick` fires every timer due by then, in order. */
function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map();
  return {
    setTimeout: (run, ms) => {
      const id = next++;
      timers.set(id, { at: now + ms, run });
      return { id, unref() {} };
    },
    clearTimeout: (handle) => timers.delete(handle?.id),
    pending: () => timers.size,
    async tick(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function fakeClient() {
  const posts = [];
  return { posts, session: { promptAsync: async (request) => void posts.push(request) } };
}

const posted = (text) => ({ path: { id: "ses_1" }, body: { parts: [{ type: "text", text, metadata: { evenKeel: { mail: text } } }] } });

describe("mailPost", () => {
  it("posts the mail found after a tool call as the user's own line, marked as mail, the text as Even Keel gave it", async () => {
    const client = fakeClient();
    const asked = [];
    const mail = mailPost({ client, mailOf: async (id, event) => (asked.push([id, event]), "Mind the docs."), clock: fakeClock() });
    await mail.afterTool("ses_1");
    expect(asked).toEqual([["ses_1", "PostToolUse"]]);
    expect(client.posts).toEqual([posted("Mind the docs.")]);
  });

  it("posts nothing when nothing waits, and Even Keel or OpenCode failing never breaks the tool call", async () => {
    const client = fakeClient();
    await mailPost({ client, mailOf: async () => null, clock: fakeClock() }).afterTool("ses_1");
    await mailPost({ client, mailOf: async () => Promise.reject(new Error("down")), clock: fakeClock() }).afterTool("ses_1");
    expect(client.posts).toEqual([]);
    const failing = { session: { promptAsync: async () => Promise.reject(new Error("closed")) } };
    await expect(mailPost({ client: failing, mailOf: async () => "x", clock: fakeClock() }).afterTool("ses_1")).resolves.toBeUndefined();
  });

  it("never breaks the tool call when OpenCode gave the plugin no client or one that throws at once", async () => {
    await expect(mailPost({ client: undefined, mailOf: async () => "x", clock: fakeClock() }).afterTool("ses_1")).resolves.toBeUndefined();
    const throwing = { session: { promptAsync: () => { throw new Error("no server"); } } };
    await expect(mailPost({ client: throwing, mailOf: async () => "x", clock: fakeClock() }).afterTool("ses_1")).resolves.toBeUndefined();
  });

  it("asks every two seconds while the session is busy and stops on its idle", async () => {
    const clock = fakeClock();
    const client = fakeClient();
    const answers = [null, "First.", null];
    let asked = 0;
    const mail = mailPost({ client, mailOf: async () => answers[asked++] ?? null, clock });
    mail.status("ses_1", "busy");
    await clock.tick(MAIL_POLL_MS - 1);
    expect(asked).toBe(0);
    await clock.tick(1);
    expect(asked).toBe(1);
    await clock.tick(MAIL_POLL_MS);
    expect(client.posts).toEqual([posted("First.")]);
    await clock.tick(MAIL_POLL_MS);
    expect(asked).toBe(3);
    mail.status("ses_1", "idle");
    await clock.tick(MAIL_POLL_MS * 5);
    expect(asked).toBe(3);
    expect(clock.pending()).toBe(0);
  });

  it("keeps one timer a session however many busy events come", async () => {
    const clock = fakeClock();
    let asked = 0;
    const mail = mailPost({ client: fakeClient(), mailOf: async () => (asked++, null), clock });
    mail.status("ses_1", "busy");
    mail.status("ses_1", "busy");
    mail.status("ses_1", "retry");
    expect(clock.pending()).toBe(1);
    mail.status("ses_2", "busy");
    expect(clock.pending()).toBe(2);
    await clock.tick(MAIL_POLL_MS);
    expect(asked).toBe(2);
  });

  it("never asks again before the last question is answered, the tool call's included", async () => {
    const clock = fakeClock();
    let open = 0;
    let most = 0;
    const answers = [];
    const mailOf = () =>
      new Promise((resolve) => {
        open++;
        most = Math.max(most, open);
        answers.push(() => (open--, resolve(null)));
      });
    const mail = mailPost({ client: fakeClient(), mailOf, clock });
    mail.status("ses_1", "busy");
    await clock.tick(MAIL_POLL_MS);
    const afterTool = mail.afterTool("ses_1");
    await clock.tick(MAIL_POLL_MS * 3);
    expect(answers.length).toBe(1);
    answers[0]();
    await flush();
    expect(answers.length).toBe(2);
    answers[1]();
    await afterTool;
    expect(most).toBe(1);
    await clock.tick(MAIL_POLL_MS);
    expect(answers.length).toBe(3);
  });

  it("posts mail found by a question that was on its way when the session went idle", async () => {
    const clock = fakeClock();
    const client = fakeClient();
    let answer;
    const mail = mailPost({ client, mailOf: () => new Promise((resolve) => (answer = resolve)), clock });
    mail.status("ses_1", "busy");
    await clock.tick(MAIL_POLL_MS);
    mail.status("ses_1", "idle");
    answer("Late.");
    await flush();
    expect(client.posts).toEqual([posted("Late.")]);
    expect(clock.pending()).toBe(0);
  });
});
