// Estimate calibration from Even Keel's statistics for the tasks tools (BTN-893), as the huly plugin's hook
// (BTN-82, BTN-152): what closed tasks estimated at each step actually took. Shown to the agent when it sets an
// estimate; a step the data disagrees with refuses the call once, so the agent sees the numbers first.
// The estimate here is minutes already: the tasks tools convert it into the tracker's unit.

const KEY = /^([A-Z][A-Z0-9]*)-\d+$/;
const WORKTREE = /^([a-z][a-z0-9]*)-\d+$/i;

const prefixOf = (value) => (typeof value === "string" && /^[A-Za-z][A-Za-z0-9]*$/.test(value.trim()) ? value.trim().toUpperCase() : null);

/**
 * Project, task and minutes of a tasks call that sets an estimate, or null for any other call. The project is the
 * key's prefix, else the call's `tracker` or `project`, else the task worktree the session runs in (`abc-12`).
 */
export function estimateCall(toolName, input, cwd = "") {
  const tool = /(?:__|^plugin_tasks_tasks_)(tasks_create|task_update)$/.exec(toolName ?? "");
  if (tool === null || input === null || typeof input !== "object") return null;
  const folder = WORKTREE.exec(String(cwd).split(/[\\/]/).filter(Boolean).at(-1) ?? "");
  const fallback = prefixOf(input.tracker) ?? prefixOf(input.project) ?? (folder === null ? null : folder[1].toUpperCase());
  if (tool[1] === "task_update") {
    if (typeof input.estimate !== "number") return null;
    const key = String(input.key ?? "").trim().toUpperCase();
    const own = KEY.exec(key);
    const project = own === null ? fallback : own[1];
    return project === null ? null : { project, task: own === null ? null : key, minutes: input.estimate };
  }
  const sized = Array.isArray(input.tasks) ? input.tasks.find((each) => typeof each?.estimate === "number") : undefined;
  if (sized === undefined || fallback === null) return null;
  return { project: fallback, task: null, minutes: sized.estimate };
}

const minutes = (value) => (value < 0.5 ? "<1" : String(Math.round(value)));

const SPREAD = 1.5;

/**
 * The step of the estimate sent, when enough closed tasks sit on it and their median is more than SPREAD times
 * away from it, with the step nearest that median; null otherwise (off the scale, thin data, close enough).
 */
export function mismatch(calibration, sentMinutes) {
  const sent = calibration?.steps?.find((step) => Math.abs(sentMinutes - step.minutes) <= 1);
  if (!sent || sent.thin || sent.median === null || sent.median <= 0) return null;
  if (sent.median * SPREAD >= sent.minutes && sent.median <= sent.minutes * SPREAD) return null;
  const distance = (step) => Math.abs(Math.log(step.minutes / sent.median));
  const nearest = calibration.steps.reduce((best, step) => (distance(step) < distance(best) ? step : best));
  return { minutes: sent.minutes, median: sent.median, nearest: nearest.minutes };
}

function stepLine(step) {
  const count = step.closed === 1 ? "1 task" : `${step.closed} tasks`;
  const thin = step.thin ? " (thin data)" : "";
  return `- ${step.minutes} min: ${count} → median ${minutes(step.median)}, middle half ${minutes(step.low)}–${minutes(step.high)}${thin}`;
}

function taskLine(task, withComponent) {
  const title = task.title ? ` ${task.title}` : "";
  const component = withComponent && task.component ? ` [${task.component}]` : "";
  const estimate = task.estimateMin === null ? "no estimate" : String(task.estimateMin);
  return `- ${task.task}${title}${component}: ${estimate} → ${minutes(task.activeMin)}`;
}

/** The text for the agent, or null when the project has no closed tasks to learn from; `refused` is a `mismatch`. */
export function calibrationText(calibration, refused = null) {
  if (!calibration || calibration.closed === 0) return null;
  const lines = [
    `Estimate calibration, project ${calibration.project}: closed tasks from Even Keel's statistics, actual = the agent's active minutes.`,
    refused
      ? `This call was refused once: you sent ${refused.minutes} min, and closed tasks estimated at ${refused.minutes} min took a median of ${minutes(refused.median)} min — the nearest step is ${refused.nearest} min. Weigh the task against the numbers below and send the same call again with the estimate you settle on; it goes through.`
      : "It reaches you after the call: if the estimate you sent disagrees with these numbers, send task_update with a corrected one.",
    "",
  ];
  const filled = calibration.steps.filter((step) => step.closed > 0);
  if (filled.length === 0) {
    lines.push("No closed task carries an estimate on this scale yet: lean on the recent tasks below.");
  } else {
    lines.push("Estimated at → actual minutes:", ...filled.map(stepLine));
  }
  if (calibration.thin && filled.length > 0) {
    lines.push(`Few closed tasks carry an estimate on this scale (${calibration.estimated}): lean on the recent tasks below.`);
  }
  if (calibration.recent.length > 0) {
    const own = calibration.scope === "component";
    lines.push(
      "",
      own
        ? `Recent closed tasks of component ${calibration.component}, estimate → actual minutes:`
        : "Recent closed tasks of the project, estimate → actual minutes:",
      ...calibration.recent.map((task) => taskLine(task, !own)),
    );
  }
  return lines.join("\n");
}
