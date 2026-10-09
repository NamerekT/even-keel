// Estimate calibration from Even Keel's statistics (BTN-82): what closed tasks estimated at each step
// actually took. Shown to the agent when it sets an estimate.

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

/** The text for the agent, or null when the project has no closed tasks to learn from. */
export function calibrationText(calibration) {
  if (!calibration || calibration.closed === 0) return null;
  const lines = [
    `Estimate calibration, project ${calibration.project}: closed tasks from Even Keel's statistics, actual = the agent's active minutes.`,
    "It reaches you after the call: if the estimation you sent disagrees with these numbers, send update_issue with a corrected one.",
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
