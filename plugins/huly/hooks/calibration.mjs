// Estimate calibration from Even Keel's statistics (BTN-82): what closed tasks estimated at each step
// actually took. Shown to the agent when it sets an estimate; a step the data disagrees with refuses the call
// once, so the agent sees the numbers before the estimate lands (BTN-152).

const TASK = /^[A-Z][A-Z0-9]*-\d+$/;

/** Project and task of a Huly call that sets an estimate, or null for any other call. */
export function estimateCall(toolName, input) {
  const tool = /__(create|update)_issue$/.exec(toolName ?? "");
  if (tool === null || typeof input?.estimation !== "number" || typeof input.project !== "string") return null;
  const project = input.project.toUpperCase();
  if (tool[1] === "create") return { project, task: null };
  const id = String(input.identifier ?? "").toUpperCase();
  const task = /^\d+$/.test(id) ? `${project}-${id}` : id;
  return { project, task: TASK.test(task) ? task : null };
}

const minutes = (value) => (value < 0.5 ? "<1" : String(Math.round(value)));

const SPREAD = 1.5;

/**
 * The step of the estimate sent, when enough closed tasks sit on it and their median is more than SPREAD times
 * away from it, with the step nearest that median; null otherwise (off the scale, thin data, close enough).
 */
export function mismatch(calibration, hours) {
  const sent = calibration?.steps?.find((step) => Math.abs(hours * 60 - step.minutes) <= 1);
  if (!sent || sent.thin || sent.median === null || sent.median <= 0) return null;
  if (sent.median * SPREAD >= sent.minutes && sent.median <= sent.minutes * SPREAD) return null;
  const distance = (step) => Math.abs(Math.log(step.minutes / sent.median));
  const nearest = calibration.steps.reduce((best, step) => (distance(step) < distance(best) ? step : best));
  return { minutes: sent.minutes, median: sent.median, nearest: nearest.minutes };
}

const hoursOf = (step) => String(Math.round((step / 60) * 100) / 100);

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
      ? `This call was refused once: you sent ${refused.minutes} min, and closed tasks estimated at ${refused.minutes} min took a median of ${minutes(refused.median)} min — the nearest step is ${refused.nearest} min (${hoursOf(refused.nearest)}). Weigh the task against the numbers below and send the same call again with the estimation you settle on; it goes through.`
      : "It reaches you after the call: if the estimation you sent disagrees with these numbers, send update_issue with a corrected one.",
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
