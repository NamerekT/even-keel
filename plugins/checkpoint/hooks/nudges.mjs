// When the checkpoint hook nudges and what it says: the thresholds from the environment, what Even Keel
// answered about the session, and the mark a context size falls on.

const DEFAULTS = { first: 200_000, step: 50_000, late: 250_000, lateStep: 25_000, hard: 300_000, maxHandoffs: 3 };
const VARIABLES = {
  first: "CHECKPOINT_FIRST_TOKENS",
  step: "CHECKPOINT_STEP_TOKENS",
  late: "CHECKPOINT_LATE_TOKENS",
  lateStep: "CHECKPOINT_LATE_STEP_TOKENS",
  hard: "CHECKPOINT_HARD_TOKENS",
  maxHandoffs: "CHECKPOINT_MAX_HANDOFFS",
};

const positive = (value) => (Number.isFinite(value) && value > 0 ? value : null);

/**
 * `answer` is what Even Keel said about the session, or null: outside a chain, or with no Even Keel at all.
 * A task that has had its handoffs is held: nothing below the hard threshold, since every further handoff
 * costs a recovery that the shorter context no longer pays back.
 */
export function planOf(env, answer) {
  const plan = { ...DEFAULTS };
  for (const [key, name] of Object.entries(VARIABLES)) plan[key] = positive(Number(env[name])) ?? plan[key];
  if (answer && answer.source !== "default") plan.first = positive(answer.first) ?? plan.first;
  plan.handoffs = positive(answer?.handoffs) ?? 0;
  plan.held = plan.handoffs >= plan.maxHandoffs;
  if (plan.held) plan.first = Math.max(plan.first, plan.hard);
  return plan;
}

export function markOf(context, plan) {
  if (context < plan.first) return 0;
  if (context >= plan.late) return plan.late + Math.floor((context - plan.late) / plan.lateStep) * plan.lateStep;
  const mark = plan.first + Math.floor((context - plan.first) / plan.step) * plan.step;
  return mark > plan.first && plan.late - mark < plan.lateStep ? mark - plan.step : mark;
}

const HOW =
  "leave the working tree as it is (no commit needed), write `.temp/handoff.md` at the root of " +
  "the working tree — what is done, what is left, the current hypotheses, what was already tried " +
  "and ruled out, the files and symbols that matter, the exact next command — and end your turn " +
  "with a final line `CHECKPOINT: .temp/handoff.md`. A fresh session picks the work up from that " +
  "note at a fraction of the cost.";

/** `last` is the mark of the previous nudge, 0 when there was none. */
export function nudge(context, last, plan) {
  const size = `Context is now ~${Math.round(context / 1000)}k tokens, and every further turn re-reads all of it. `;
  if (last > 0) {
    return (
      size +
      "You were already asked for a checkpoint and carried on. Make it now, or, if the change you " +
      `are in the middle of does not build yet, as soon as it builds: ${HOW} ` +
      "That the next step needs what is loaded right now is not a reason to carry on: put what it " +
      "needs into the note. Carry on only if all that is left is the merge and the final report."
    );
  }
  if (plan.held) {
    return (
      size +
      `This task has already been handed over ${plan.handoffs} times, and every handoff costs the next ` +
      "session its recovery, so you were not asked for a checkpoint earlier. At this size it pays off " +
      `again: make one now, or, if the change you are in the middle of does not build yet, as soon as it builds: ${HOW} ` +
      "Carry on only if all that is left is the merge and the final report."
    );
  }
  return (
    size +
    "If the code for the current step is written and what comes next is a loop of checks " +
    "(repeated test runs, trace-and-fix debugging, engine checks, screenshots) or the wrap-up " +
    `(docs, review, merge), make a checkpoint before it: ${HOW} ` +
    "If you are in the middle of a change that does not build yet, or the next step needs " +
    "what is loaded right now, carry on and checkpoint at the next stable point instead."
  );
}
